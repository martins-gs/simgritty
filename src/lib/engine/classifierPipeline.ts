import type { ClassifierResult } from "@/types/simulation";
import type { StructuredVoiceProfile } from "@/types/voice";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";

export interface MilestoneContext {
  id: string;
  description: string;
  classifier_hint: string;
}

export interface ClassifierContext {
  recentTurns: { speaker: string; content: string }[];
  scenarioContext: string;
  currentEscalation: number;
  speakerVoiceProfile?: StructuredVoiceProfile | null;
  milestones?: MilestoneContext[];
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

const COMPOSURE_MARKER = z.enum([
  "defensive_language",
  "dismissive_response",
  "hostility_mirroring",
  "sarcasm",
  "interruption",
]);

const DE_ESCALATION_TECHNIQUE = z.enum([
  "validation",
  "empathy",
  "reframing",
  "concrete_help",
  "naming_emotion",
  "open_question",
]);

const TRAINEE_SCORING_SCHEMA = z.object({
  technique: z.string(),
  effectiveness: z.number(),
  tags: z.array(z.string()),
  confidence: z.number(),
  reasoning: z.string(),
  composure_markers: z.array(COMPOSURE_MARKER)
    .describe("Negative composure indicators detected in this utterance. Empty array if none."),
  de_escalation_attempt: z.boolean()
    .describe("Whether this utterance contains a deliberate de-escalation behaviour."),
  de_escalation_technique: DE_ESCALATION_TECHNIQUE.nullable()
    .describe("The de-escalation technique used, if de_escalation_attempt is true. Null otherwise."),
  clinical_milestone_completed: z.string().nullable()
    .describe("The milestone ID satisfied by this utterance, if applicable. Null otherwise."),
});

const TRAINEE_CLASSIFIER_SYSTEM_PROMPT = `You are an expert communication skills assessor for clinical training scenarios.

Analyse the trainee clinician's latest utterance and classify the communication technique used.

IMPORTANT: You are assessing the TRAINEE's communication quality, not the simulated patient's behaviour.

Escalating behaviours (negative effectiveness):
- dismissive language (-0.5 to -1.0)
- telling someone to "calm down" badly (-0.3 to -0.7)
- contradiction or uncertainty (-0.2 to -0.5)
- ignoring emotions (-0.3 to -0.7)
- excessive jargon (-0.2 to -0.4)
- patronising tone (-0.4 to -0.8)
- perceived blame (-0.5 to -0.9)
- failure to answer a direct question (-0.3 to -0.6)
- minimal or non-substantive responses when the subject is asking for help, information, or engagement — e.g. "yes", "ok", "right", "mmm" repeated without addressing what the subject actually said (-0.2 to -0.5)

De-escalating behaviours (positive effectiveness):
- acknowledgement of distress (+0.3 to +0.7)
- clear explanation (+0.2 to +0.5)
- concrete next step (+0.3 to +0.6)
- appropriate apology (+0.2 to +0.5)
- reflective listening (+0.4 to +0.8)
- respectful tone (+0.2 to +0.4)
- calm boundary setting (+0.3 to +0.6)
- naming the emotion (+0.4 to +0.7)

COMPOSURE MARKERS — flag any of these negative indicators if present in the utterance:
- "defensive_language": trainee justifies or deflects rather than engaging (e.g. "I'm just doing my job", "That's not my fault")
- "dismissive_response": trainee minimises or brushes off the subject's concern (e.g. "Calm down", "You're overreacting")
- "hostility_mirroring": trainee matches the subject's aggressive tone or language
- "sarcasm": trainee uses sarcasm or passive-aggressive phrasing
- "interruption": trainee interrupts the subject mid-utterance

Return an empty array for composure_markers if none are detected.

DE-ESCALATION ATTEMPT — set de_escalation_attempt to true if the utterance contains a deliberate de-escalation behaviour. If true, classify the technique:
- "validation": acknowledging the subject's emotion or experience
- "empathy": expressing understanding of the subject's position
- "reframing": redirecting the conversation toward a constructive frame
- "concrete_help": offering a specific, actionable next step
- "naming_emotion": explicitly identifying what the subject appears to be feeling
- "open_question": asking an open question that invites the subject to express their concern

Set de_escalation_technique to null if de_escalation_attempt is false.

CLINICAL MILESTONES — if milestones are provided in the user prompt, check whether this utterance satisfies any of them. Return the milestone ID if so, null otherwise. Each milestone can only be completed once.`;

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
  userPrompt: string,
  options?: { schema?: z.ZodType; schemaName?: string; maxTokens?: number }
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

  const schema = options?.schema ?? CLASSIFIER_OUTPUT_SCHEMA;
  const schemaName = options?.schemaName ?? "utterance_classifier";
  const maxTokens = options?.maxTokens ?? 220;

  try {
    const response = await client.responses.parse({
      model: CLASSIFIER_MODEL,
      instructions: systemPrompt,
      input: userPrompt,
      store: false,
      reasoning: { effort: "none" },
      max_output_tokens: maxTokens,
      text: {
        format: zodTextFormat(schema, schemaName),
        verbosity: "low",
      },
    });

    const raw = response.output_parsed;
    if (!raw) {
      throw new Error("No parsed classifier output returned");
    }

    // Cast to Record for dynamic field access — the Zod schema guarantees shape
    const parsed = raw as Record<string, unknown>;

    const base: ClassifierResult = {
      technique: (parsed.technique as string) || "unknown",
      effectiveness: Math.max(-1, Math.min(1, (parsed.effectiveness as number) || 0)),
      tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : [],
      confidence: Math.max(0, Math.min(1, (parsed.confidence as number) || 0)),
      reasoning: (parsed.reasoning as string) || "",
    };

    // Attach scoring fields when using the trainee scoring schema
    if ("composure_markers" in parsed) {
      base.composure_markers = Array.isArray(parsed.composure_markers)
        ? (parsed.composure_markers as ClassifierResult["composure_markers"])
        : [];
      base.de_escalation_attempt = Boolean(parsed.de_escalation_attempt);
      base.de_escalation_technique =
        (parsed.de_escalation_technique as ClassifierResult["de_escalation_technique"]) ?? null;
      base.clinical_milestone_completed =
        (parsed.clinical_milestone_completed as string) ?? null;
    }

    return base;
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

  let milestoneBlock = "";
  if (context.milestones && context.milestones.length > 0) {
    const milestoneLines = context.milestones
      .map((m) => `- ID: "${m.id}" | ${m.description} | Hint: ${m.classifier_hint}`)
      .join("\n");
    milestoneBlock = `\n\nClinical milestones to check against:\n${milestoneLines}`;
  } else {
    milestoneBlock = "\n\nNo clinical milestones defined for this scenario. Return null for clinical_milestone_completed.";
  }

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
- the structured delivery profile, if provided, which describes how the utterance sounded emotionally and vocally.${milestoneBlock}`;

  return requestClassification(
    apiKey,
    TRAINEE_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt,
    { schema: TRAINEE_SCORING_SCHEMA, schemaName: "trainee_scoring", maxTokens: 400 }
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
