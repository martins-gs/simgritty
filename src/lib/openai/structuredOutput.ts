import type { Response } from "openai/resources/responses/responses";
import type { ZodType } from "zod";

function collectResponseOutputTextSegments(response: Response) {
  const segments: string[] = [];

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    segments.push(response.output_text.trim());
  }

  for (const item of response.output) {
    if (item.type !== "message") continue;

    for (const content of item.content) {
      if (content.type === "output_text" && content.text.trim()) {
        segments.push(content.text.trim());
      }
    }
  }

  return [...new Set(segments)].filter(Boolean);
}

function collectResponseRefusalSegments(response: Response) {
  const segments: string[] = [];

  for (const item of response.output) {
    if (item.type !== "message") continue;

    for (const content of item.content) {
      if (content.type === "refusal" && content.refusal.trim()) {
        segments.push(content.refusal.trim());
      }
    }
  }

  return segments;
}

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function buildJsonCandidates(value: string) {
  const cleaned = stripCodeFences(value).replace(/\u0000/g, "").trim();
  if (!cleaned) {
    return [];
  }

  const candidates = new Set<string>([cleaned]);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(cleaned.slice(firstBrace, lastBrace + 1));
  }

  return [...candidates];
}

export function getResponseOutputText(response: Response) {
  return collectResponseOutputTextSegments(response).join("\n").trim();
}

export function describeStructuredOutputFailure(response: Response | null | undefined) {
  if (!response) {
    return "no response returned";
  }

  if (response.status === "incomplete") {
    const reason = response.incomplete_details?.reason ?? "unknown reason";
    return `response incomplete (${reason})`;
  }

  if (response.error?.message) {
    return `response failed (${response.error.message})`;
  }

  const refusal = collectResponseRefusalSegments(response).join(" ").trim();
  if (refusal) {
    return `model refusal (${refusal})`;
  }

  const text = getResponseOutputText(response);
  if (!text) {
    return `no output text available (status=${response.status})`;
  }

  return `unparseable output (status=${response.status})`;
}

export function parseStructuredOutputText<T>(
  response: Response | string | null | undefined,
  schema: ZodType<T>
) {
  const rawText = typeof response === "string"
    ? response
    : response
      ? getResponseOutputText(response)
      : "";

  for (const candidate of buildJsonCandidates(rawText)) {
    try {
      const parsedJson = JSON.parse(candidate);
      const parsed = schema.safeParse(parsedJson);
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      continue;
    }
  }

  return null;
}
