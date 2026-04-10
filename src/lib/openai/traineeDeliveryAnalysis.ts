import { zodTextFormat } from "openai/helpers/zod";
import { traineeDeliveryAnalysisSchema } from "@/lib/validation/schemas";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import type { TraineeDeliveryAnalysis } from "@/types/simulation";

const AUDIO_ANALYSIS_MODEL = process.env.OPENAI_TRAINEE_AUDIO_ANALYSIS_MODEL || "gpt-audio";
const AUDIO_ANALYSIS_STRUCTURER_MODEL =
  process.env.OPENAI_TRAINEE_AUDIO_STRUCTURER_MODEL || "gpt-5.4-mini";

interface TraineeDeliveryAnalysisInput {
  utterance: string;
  scenarioContext: string;
  currentEscalation: number;
  recentTurns: { speaker: string; content: string }[];
  audioBase64: string;
  durationMs?: number | null;
}

function formatRecentTurns(turns: { speaker: string; content: string }[]): string {
  if (turns.length === 0) return "No prior turns.";

  const speakerLabels: Record<string, string> = {
    trainee: "Trainee clinician",
    ai: "Patient or relative",
    system: "AI clinician",
  };

  return turns
    .slice(-8)
    .map((turn) => `${speakerLabels[turn.speaker] || turn.speaker}: ${turn.content}`)
    .join("\n");
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

function normalizeVoiceProfile(profile: unknown): Record<string, unknown> | null {
  if (typeof profile !== "object" || profile === null) {
    return null;
  }

  const record = profile as Record<string, unknown>;
  return {
    accent: record.accent ?? "",
    voiceAffect: record.voiceAffect ?? record.voice_affect ?? "",
    tone: record.tone ?? "",
    pacing: record.pacing ?? "",
    emotion: record.emotion ?? "",
    delivery: record.delivery ?? "",
    variety: record.variety ?? "",
  };
}

function normalizeAnalysisCandidate(candidate: unknown): unknown {
  if (typeof candidate !== "object" || candidate === null) {
    return candidate;
  }

  const record = candidate as Record<string, unknown>;
  const markers = Array.isArray(record.markers)
    ? record.markers
    : typeof record.markers === "string"
      ? record.markers.split(",").map((marker) => marker.trim()).filter(Boolean)
      : [];

  const acousticEvidence = Array.isArray(record.acousticEvidence)
    ? record.acousticEvidence
    : Array.isArray(record.acoustic_evidence)
      ? record.acoustic_evidence
      : typeof record.acousticEvidence === "string"
        ? [record.acousticEvidence]
        : typeof record.acoustic_evidence === "string"
          ? [record.acoustic_evidence]
          : [];

  const normalized = {
    source: "audio",
    confidence:
      typeof record.confidence === "number"
        ? record.confidence
        : Number(record.confidence ?? 0),
    summary:
      typeof record.summary === "string"
        ? record.summary
        : typeof record.overall_summary === "string"
          ? record.overall_summary
          : "",
    markers,
    acousticEvidence,
    duration_ms:
      typeof record.duration_ms === "number" || record.duration_ms === null
        ? record.duration_ms
        : typeof record.durationMs === "number" || record.durationMs === null
          ? record.durationMs
          : null,
    voiceProfile: normalizeVoiceProfile(record.voiceProfile ?? record.voice_profile),
  };

  return normalized;
}

function tryParseStructuredAnalysis(raw: string): TraineeDeliveryAnalysis | null {
  try {
    const parsedJson = JSON.parse(extractLikelyJSONObject(raw));
    const normalized = normalizeAnalysisCandidate(parsedJson);
    const parsed = traineeDeliveryAnalysisSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function requestAnalysis(
  input: TraineeDeliveryAnalysisInput,
  responseFormat?: { type: "json_object" }
): Promise<string> {
  const client = getOpenAIClient();
  if (!client) {
    const error = new Error("OPENAI_API_KEY not configured");
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return "";
  }

  const completion = await client.chat.completions.create({
    model: AUDIO_ANALYSIS_MODEL,
    modalities: ["text"],
    response_format: responseFormat,
    messages: [
      {
        role: "developer",
        content: `You assess a trainee clinician's vocal delivery in a live NHS communication simulation.

Use the ACTUAL AUDIO as the primary evidence. Use the transcript and conversation context only to interpret the vocal delivery correctly.

Your job is to decide how the trainee truly sounded, not how the words might sound on paper.
Be careful with sarcasm, irritation, clipped delivery, tension, defensiveness, warmth, and vocal steadiness.
If the audio quality is weak or the evidence is ambiguous, reduce confidence and say so.
Return valid JSON only. Do not wrap the JSON in markdown fences.

Return one JSON object with:
- source: always "audio"
- confidence: number from 0 to 1
- summary: one short sentence about how the trainee came across vocally
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
- acousticEvidence: 2-4 short concrete phrases about what you heard
- duration_ms: the clip duration in milliseconds or null
- voiceProfile: object with accent, voiceAffect, tone, pacing, emotion, delivery, variety

Rules:
- Do not infer negative tone from words alone if the audio does not support it.
- Do not ignore obvious vocal sarcasm or irritation just because the words look polite.
- Prefer 0-3 markers unless the evidence is unusually strong.
- Use British English.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Scenario: ${input.scenarioContext}
Current escalation level: ${input.currentEscalation}/10
Clip duration: ${input.durationMs ?? "unknown"} ms

Recent conversation:
${formatRecentTurns(input.recentTurns)}

Transcript of the trainee utterance:
"${input.utterance}"

Assess how this line actually sounded in the audio.`,
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
    max_completion_tokens: 450,
  });

  return extractAssistantText(completion.choices[0]?.message?.content);
}

async function structureAnalysisText(
  rawAnalysis: string,
  input: TraineeDeliveryAnalysisInput
): Promise<TraineeDeliveryAnalysis | null> {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }

  try {
    const response = await client.responses.parse({
      model: AUDIO_ANALYSIS_STRUCTURER_MODEL,
      instructions: `You convert a free-form audio-analysis result into a strict schema.

Do not invent evidence that is not present in the supplied analysis.
Preserve the fact that the source is audio-derived.
If the audio analysis is vague or uncertain, keep confidence low.
Return only the schema.`,
      input: `Scenario: ${input.scenarioContext}
Current escalation level: ${input.currentEscalation}/10
Clip duration: ${input.durationMs ?? "unknown"} ms

Recent conversation:
${formatRecentTurns(input.recentTurns)}

Transcript of the trainee utterance:
"${input.utterance}"

Raw audio-model analysis:
${rawAnalysis}`,
      store: false,
      reasoning: { effort: "minimal" },
      max_output_tokens: 500,
      text: {
        format: zodTextFormat(traineeDeliveryAnalysisSchema, "trainee_delivery_analysis"),
        verbosity: "low",
      },
    });

    return (response.output_parsed as TraineeDeliveryAnalysis | null) ?? null;
  } catch (error) {
    console.error("Trainee delivery structuring error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}

export async function analyzeTraineeDeliveryFromAudio(
  input: TraineeDeliveryAnalysisInput
): Promise<TraineeDeliveryAnalysis | null> {
  try {
    const raw =
      await requestAnalysis(input, { type: "json_object" })
      || await requestAnalysis(input);

    if (!raw) {
      throw new Error("No audio analysis output returned");
    }

    const direct = tryParseStructuredAnalysis(raw);
    if (direct) {
      return direct;
    }

    console.warn(
      "Trainee delivery analysis parse fallback triggered:",
      raw.slice(0, 600)
    );

    const structured = await structureAnalysisText(raw, input);
    if (structured) {
      return structured;
    }

    throw new Error("Unable to derive structured trainee audio analysis");
  } catch (error) {
    console.error("Trainee delivery analysis error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}
