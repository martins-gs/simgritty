import { traineeDeliveryAnalysisSchema } from "@/lib/validation/schemas";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import type { TraineeDeliveryAnalysis } from "@/types/simulation";

const AUDIO_ANALYSIS_MODEL = process.env.OPENAI_TRAINEE_AUDIO_ANALYSIS_MODEL || "gpt-audio";

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

    const parsed = traineeDeliveryAnalysisSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    return parsed.data;
  } catch (error) {
    console.error("Trainee delivery analysis error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}
