import { zodTextFormat } from "openai/helpers/zod";
import { parseStructuredOutputText, describeStructuredOutputFailure } from "@/lib/openai/structuredOutput";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { sessionDeliveryAnalysisSchema } from "@/lib/validation/schemas";
import type {
  SessionDeliveryAnalysis,
  TranscriptTurn,
} from "@/types/simulation";

const SESSION_AUDIO_ANALYSIS_MODEL =
  process.env.OPENAI_SESSION_AUDIO_ANALYSIS_MODEL || "gpt-audio";
const SESSION_AUDIO_STRUCTURER_MODEL =
  process.env.OPENAI_SESSION_AUDIO_STRUCTURER_MODEL || "gpt-5.4";
const SESSION_DELIVERY_CONFIDENCE_THRESHOLD = 0.55;

interface SessionDeliveryAnalysisInput {
  scenarioContext: string;
  transcriptTurns: TranscriptTurn[];
  audioBase64: string;
  durationMs?: number | null;
}

function extractAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      if ("text" in part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("\n")
    .trim();
}

function extractLikelyJSONObject(raw: string): string {
  const trimmed = raw.trim();
  const withoutCodeFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (withoutCodeFences.startsWith("{") && withoutCodeFences.endsWith("}")) {
    return withoutCodeFences;
  }

  const firstBrace = withoutCodeFences.indexOf("{");
  const lastBrace = withoutCodeFences.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutCodeFences.slice(firstBrace, lastBrace + 1);
  }

  return withoutCodeFences;
}

function repairLooseJson(raw: string): string {
  return extractLikelyJSONObject(raw).replace(
    /("trend"\s*:\s*)(improving|worsening|steady|mixed)(\s*[,}])/g,
    '$1"$2"$3'
  );
}

function formatTranscriptTurns(turns: TranscriptTurn[]) {
  if (turns.length === 0) return "No transcript turns were stored.";

  return turns
    .slice()
    .sort((a, b) => a.turn_index - b.turn_index)
    .map((turn) => {
      const speakerLabel =
        turn.speaker === "trainee"
          ? "Trainee clinician"
          : turn.speaker === "ai"
            ? "Patient or relative"
            : "AI clinician";
      const duration = typeof turn.duration_ms === "number"
        ? ` (${turn.duration_ms} ms)`
        : "";
      return `Turn ${turn.turn_index} - ${speakerLabel}${duration}: ${turn.content}`;
    })
    .join("\n");
}

function getTraineeTurnIndexes(turns: TranscriptTurn[]) {
  return turns
    .filter((turn) => turn.speaker === "trainee")
    .map((turn) => turn.turn_index);
}

function normalizeCandidate(
  candidate: unknown,
  validTurnIndexes: Set<number>
): SessionDeliveryAnalysis | null {
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const markers = Array.isArray(record.markers)
    ? record.markers.filter((value): value is string => typeof value === "string")
    : [];
  const evidenceTurnIndexes = Array.isArray(record.evidenceTurnIndexes)
    ? record.evidenceTurnIndexes
    : Array.isArray(record.evidence_turn_indexes)
      ? record.evidence_turn_indexes
      : [];
  const normalized = {
    source: "session_audio" as const,
    confidence:
      typeof record.confidence === "number"
        ? record.confidence
        : Number(record.confidence ?? 0),
    supported: Boolean(record.supported),
    summary:
      typeof record.summary === "string"
        ? record.summary.trim() || null
        : null,
    markers,
    evidenceTurnIndexes: evidenceTurnIndexes
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isInteger(value) && validTurnIndexes.has(value)),
    trend:
      record.trend === "improving" ||
      record.trend === "worsening" ||
      record.trend === "steady" ||
      record.trend === "mixed"
        ? record.trend
        : null,
    acousticEvidence: Array.isArray(record.acousticEvidence)
      ? record.acousticEvidence.filter((value): value is string => typeof value === "string")
      : Array.isArray(record.acoustic_evidence)
        ? record.acoustic_evidence.filter((value): value is string => typeof value === "string")
        : [],
  };

  const parsed = sessionDeliveryAnalysisSchema.safeParse(normalized);
  if (!parsed.success) {
    return null;
  }

  const result = parsed.data;
  if (
    result.confidence < SESSION_DELIVERY_CONFIDENCE_THRESHOLD ||
    result.evidenceTurnIndexes.length < 2
  ) {
    return {
      ...result,
      supported: false,
      summary: null,
      trend: null,
    };
  }

  if (!result.supported) {
    return {
      ...result,
      summary: null,
      trend: null,
    };
  }

  return result.summary
    ? result
    : {
        ...result,
        supported: false,
        trend: null,
      };
}

function tryParseStructuredAnalysis(
  raw: string,
  validTurnIndexes: Set<number>
): SessionDeliveryAnalysis | null {
  try {
    const parsed = JSON.parse(repairLooseJson(raw));
    return normalizeCandidate(parsed, validTurnIndexes);
  } catch {
    return null;
  }
}

async function requestRawAnalysis(
  input: SessionDeliveryAnalysisInput
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) {
    const error = new Error("OPENAI_API_KEY not configured");
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return "";
  }

  const transcriptTurns = formatTranscriptTurns(input.transcriptTurns);
  const traineeTurnIndexes = getTraineeTurnIndexes(input.transcriptTurns).join(", ") || "none";

  const completion = await client.chat.completions.create({
    model: SESSION_AUDIO_ANALYSIS_MODEL,
    modalities: ["text"],
    messages: [
      {
        role: "developer",
        content: `You assess the trainee clinician's vocal delivery across a full mixed session recording.

Use the ACTUAL AUDIO as the primary evidence.
Use the transcript turn list only to identify when the trainee is speaking and to anchor evidence to trainee turn indexes.
Focus only on the trainee clinician's voice, not the patient or AI voice.
Do not comment on accent, nationality, class, or identity.

Return valid JSON only with:
- source: always "session_audio"
- confidence: number from 0 to 1
- supported: boolean
- summary: null or one short learner-facing sentence for an overall delivery card
- markers: array chosen only from:
  calm_measured
  warm_empathic
  tense_hurried
  flat_detached
  defensive_tone
  sarcastic_tone
  irritated_tone
  hostile_tone
  anxious_unsteady
- evidenceTurnIndexes: 2 to 4 trainee turn indexes that best support the pattern, or [] if unsupported
- trend: improving, worsening, steady, mixed, or null
- acousticEvidence: 2 to 6 short concrete phrases about pace, tone, tension, warmth, or steadiness heard in the audio

Rules:
- Set supported=true only if there is a recurrent delivery pattern across at least two trainee turns, or a clear session-level shift that is strong enough to mention in feedback.
- If evidence is weak, mixed, or isolated to one moment, set supported=false and summary=null.
- Ignore wording quality unless the audio supports a vocal pattern.
- Keep the summary in British English.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Scenario context: ${input.scenarioContext}
Full recording duration: ${input.durationMs ?? "unknown"} ms
Valid trainee turn indexes: ${traineeTurnIndexes}

Transcript turns:
${transcriptTurns}

Assess the trainee clinician's overall vocal delivery across the full recording.`,
          },
          {
            type: "input_audio",
            input_audio: {
              data: input.audioBase64,
              format: "wav",
            },
          },
        ],
      },
    ],
    temperature: 0.2,
    max_completion_tokens: 700,
  });

  return extractAssistantText(completion.choices[0]?.message?.content);
}

async function structureRawAnalysis(
  rawAnalysis: string,
  input: SessionDeliveryAnalysisInput
): Promise<SessionDeliveryAnalysis | null> {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }

  const validTurnIndexes = getTraineeTurnIndexes(input.transcriptTurns);
  const transcriptTurns = formatTranscriptTurns(input.transcriptTurns);

  try {
    const response = await client.responses.create({
      model: SESSION_AUDIO_STRUCTURER_MODEL,
      instructions: `You convert a free-form full-session audio review into a strict session-delivery schema.

Do not invent evidence that is not present in the supplied analysis.
Evidence turn indexes must refer only to trainee turns from the supplied transcript.
Ignore accent completely.
Set supported=false and summary=null unless the analysis shows a learner-relevant pattern across at least two trainee turns or a clear session-level shift.
Keep the output concise and faithful to the supplied analysis.`,
      input: `Scenario context: ${input.scenarioContext}
Full recording duration: ${input.durationMs ?? "unknown"} ms
Valid trainee turn indexes: ${validTurnIndexes.join(", ") || "none"}

Transcript turns:
${transcriptTurns}

Raw audio-model analysis:
${rawAnalysis}`,
      store: false,
      reasoning: { effort: "high" },
      max_output_tokens: 500,
      text: {
        format: zodTextFormat(sessionDeliveryAnalysisSchema, "session_delivery_analysis"),
        verbosity: "low",
      },
    });

    const parsed = parseStructuredOutputText(response, sessionDeliveryAnalysisSchema);
    if (!parsed) {
      throw new SyntaxError(
        `Unable to parse session delivery JSON (${describeStructuredOutputFailure(response)})`
      );
    }

    return normalizeCandidate(parsed, new Set(validTurnIndexes));
  } catch (error) {
    console.error("Session delivery structuring error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}

export async function analyzeSessionDeliveryFromAudio(
  input: SessionDeliveryAnalysisInput
): Promise<SessionDeliveryAnalysis | null> {
  const validTurnIndexes = new Set(getTraineeTurnIndexes(input.transcriptTurns));
  if (validTurnIndexes.size < 2) {
    return null;
  }

  try {
    const raw = await requestRawAnalysis(input);
    if (!raw) {
      throw new Error("No session delivery analysis output returned");
    }

    const direct = tryParseStructuredAnalysis(raw, validTurnIndexes);
    if (direct) {
      return direct;
    }

    console.warn(
      "Session delivery analysis parse fallback triggered:",
      raw.slice(0, 600)
    );

    const structured = await structureRawAnalysis(raw, input);
    if (structured) {
      return structured;
    }

    throw new Error("Unable to derive structured session delivery analysis");
  } catch (error) {
    console.error("Session delivery analysis error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}
