import type { ClassifierResult } from "@/types/simulation";
import type { StructuredVoiceProfile } from "@/types/voice";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";

export interface ClassifierContext {
  recentTurns: { speaker: string; content: string }[];
  scenarioContext: string;
  currentEscalation: number;
  speakerVoiceProfile?: StructuredVoiceProfile | null;
}

export type ClassifierMode = "trainee_utterance" | "patient_response" | "clinician_utterance";

const CLASSIFIER_MODEL = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-5.4-mini";

const CLASSIFIER_OUTPUT_SCHEMA = z.object({
  technique: z.string(),
  effectiveness: z.number(),
  tags: z.array(z.string()),
  confidence: z.number(),
  reasoning: z.string(),
});

const TRAINEE_CLASSIFIER_SYSTEM_PROMPT = `You are an expert communication skills assessor for clinical training scenarios.

Analyse the trainee clinician's latest utterance and classify the communication technique used.

IMPORTANT: You are assessing the TRAINEE's communication quality, not the simulated patient's behaviour.

Respond in JSON format only:
{
  "technique": "string - name of the communication technique detected",
  "effectiveness": "number from -1.0 to 1.0 where negative means escalating/poor, positive means de-escalating/good",
  "tags": ["array of short descriptor tags"],
  "confidence": "number from 0 to 1",
  "reasoning": "brief one-sentence explanation"
}

Escalating behaviours (negative effectiveness):
- dismissive language (-0.5 to -1.0)
- telling someone to "calm down" badly (-0.3 to -0.7)
- contradiction or uncertainty (-0.2 to -0.5)
- ignoring emotions (-0.3 to -0.7)
- excessive jargon (-0.2 to -0.4)
- patronising tone (-0.4 to -0.8)
- perceived blame (-0.5 to -0.9)
- failure to answer a direct question (-0.3 to -0.6)

De-escalating behaviours (positive effectiveness):
- acknowledgement of distress (+0.3 to +0.7)
- clear explanation (+0.2 to +0.5)
- concrete next step (+0.3 to +0.6)
- appropriate apology (+0.2 to +0.5)
- reflective listening (+0.4 to +0.8)
- respectful tone (+0.2 to +0.4)
- calm boundary setting (+0.3 to +0.6)
- naming the emotion (+0.4 to +0.7)`;

const PATIENT_RESPONSE_CLASSIFIER_SYSTEM_PROMPT = `You are monitoring a simulated patient or relative in a live clinical de-escalation scenario.

Analyse the patient's latest utterance and classify what it indicates about their current state.

IMPORTANT: You are assessing the PATIENT OR RELATIVE'S state shift, not the clinician's communication quality.

Respond in JSON format only:
{
  "technique": "string - short label for the patient's current stance or shift",
  "effectiveness": "number from -1.0 to 1.0 where negative means more escalated / less trusting / less willing to listen, and positive means calmer / more trusting / more willing to listen",
  "tags": ["array of short descriptor tags"],
  "confidence": "number from 0 to 1",
  "reasoning": "brief one-sentence explanation"
}

Negative effectiveness indicators:
- increased hostility, blame, threats, or contempt
- refusal to listen or direct rejection of help
- more distrustful, accusatory, or absolutist language
- more chaotic, repetitive, or emotionally flooded speech

Positive effectiveness indicators:
- more reflective or direct engagement with the clinician
- acceptance of a next step, boundary, or explanation
- calmer questions, clearer thinking, or reduced hostility
- signs of trust, listening, or emotional settling

Neutral effectiveness:
- still distressed, but no clear movement toward either escalation or de-escalation`;

const CLINICIAN_CLASSIFIER_SYSTEM_PROMPT = `You are monitoring an experienced NHS clinician taking over a live de-escalation conversation.

Analyse the clinician's latest utterance and classify what effect it is likely to have on the patient or relative's state.

IMPORTANT: You are assessing the likely impact of the CLINICIAN'S turn on the patient or relative, not grading a trainee.

Respond in JSON format only:
{
  "technique": "string - short label for the clinician's communication move",
  "effectiveness": "number from -1.0 to 1.0 where negative means likely to escalate or shut the patient down, and positive means likely to calm, build trust, or increase willingness to listen",
  "tags": ["array of short descriptor tags"],
  "confidence": "number from 0 to 1",
  "reasoning": "brief one-sentence explanation"
}

Negative effectiveness indicators:
- patronising or over-reassuring phrasing
- vague or evasive answers
- weak, confusing, or poorly timed boundaries
- language likely to provoke defensiveness or distrust
- delivery likely to sound hesitant, cold, scripted, or reactive

Positive effectiveness indicators:
- validation that lands credibly
- calm, plain-spoken reassurance
- clear practical next steps
- respectful, steady boundary setting
- delivery likely to sound grounded, believable, and containing`;

function formatVoiceProfile(profile?: StructuredVoiceProfile | null): string {
  if (!profile) return "No structured voice profile provided for the latest utterance.";
  return [
    `- Accent: ${profile.accent}`,
    `- Voice affect: ${profile.voiceAffect}`,
    `- Tone: ${profile.tone}`,
    `- Pacing: ${profile.pacing}`,
    `- Emotion: ${profile.emotion}`,
    `- Delivery: ${profile.delivery}`,
    `- Variety: ${profile.variety}`,
  ].join("\n");
}

async function requestClassification(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<ClassifierResult> {
  const client = getOpenAIClient();
  if (!client || !apiKey) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    return {
      technique: "unknown",
      effectiveness: 0,
      tags: [],
      confidence: 0,
      reasoning: "Classification failed",
    };
  }

  try {
    const response = await client.responses.parse({
      model: CLASSIFIER_MODEL,
      instructions: systemPrompt,
      input: userPrompt,
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: 220,
      text: {
        format: zodTextFormat(CLASSIFIER_OUTPUT_SCHEMA, "utterance_classifier"),
        verbosity: "low",
      },
    });

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("No parsed classifier output returned");
    }

    return {
      technique: parsed.technique || "unknown",
      effectiveness: Math.max(-1, Math.min(1, parsed.effectiveness || 0)),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }

    return {
      technique: "unknown",
      effectiveness: 0,
      tags: [],
      confidence: 0,
      reasoning: "Failed to parse classification",
    };
  }
}

export async function classifyUtterance(
  utterance: string,
  context: ClassifierContext,
  apiKey: string
): Promise<ClassifierResult> {
  const recentContext = context.recentTurns
    .slice(-3)
    .map((t) => `${t.speaker}: ${t.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${context.scenarioContext}
Current escalation level: ${context.currentEscalation}/10

Recent conversation:
${recentContext}

Structured delivery profile for the latest TRAINEE utterance:
${formatVoiceProfile(context.speakerVoiceProfile)}

TRAINEE's latest utterance to classify:
"${utterance}"

Assess the trainee's effect on the interaction using both:
- the literal words
- the structured delivery profile, if provided, which describes how the utterance sounded emotionally and vocally.`;

  return requestClassification(
    apiKey,
    TRAINEE_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt
  );
}

export async function classifyPatientResponse(
  utterance: string,
  context: ClassifierContext,
  apiKey: string
): Promise<ClassifierResult> {
  const recentContext = context.recentTurns
    .slice(-4)
    .map((turn) => `${turn.speaker}: ${turn.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${context.scenarioContext}
Current escalation level: ${context.currentEscalation}/10

Recent conversation:
${recentContext}

Structured delivery profile for the latest clinician utterance:
${formatVoiceProfile(context.speakerVoiceProfile)}

PATIENT OR RELATIVE's latest utterance to classify for state movement:
"${utterance}"

Assess whether this shows the person becoming more escalated and closed-off, more settled and open, or roughly unchanged.

Use both:
- the literal words in the patient's latest utterance
- the structured delivery profile for the preceding clinician utterance, if provided, because the patient's reaction depends partly on how that clinician line landed emotionally.`;

  return requestClassification(
    apiKey,
    PATIENT_RESPONSE_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt
  );
}

export async function classifyClinicianUtterance(
  utterance: string,
  context: ClassifierContext,
  apiKey: string
): Promise<ClassifierResult> {
  const recentContext = context.recentTurns
    .slice(-4)
    .map((turn) => `${turn.speaker}: ${turn.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${context.scenarioContext}
Current escalation level: ${context.currentEscalation}/10

Recent conversation:
${recentContext}

Structured delivery profile for the latest clinician utterance:
${formatVoiceProfile(context.speakerVoiceProfile)}

CLINICIAN's latest utterance to classify:
"${utterance}"

Assess the likely effect of this clinician turn using both:
- the literal words
- the structured delivery profile, if provided, which describes how the utterance sounded emotionally and vocally.`;

  return requestClassification(
    apiKey,
    CLINICIAN_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt
  );
}
