import type { Response } from "openai/resources/responses/responses";
import type { ZodType } from "zod";

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
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  for (const item of response.output) {
    if (item.type !== "message") continue;

    for (const content of item.content) {
      if (content.type === "output_text" && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return "";
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
