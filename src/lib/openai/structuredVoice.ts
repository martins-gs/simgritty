import type { EscalationState } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig } from "@/types/scenario";
import type { StructuredClinicianTurn, StructuredVoiceProfile } from "@/types/voice";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { describeStructuredOutputFailure, parseStructuredOutputText } from "@/lib/openai/structuredOutput";
import { formatBiasCategories, hasConfiguredBias } from "@/lib/engine/biasBehaviour";
import { renderVoiceProfileForPrompt } from "@/lib/voice/renderVoiceProfile";

const VOICE_PROFILE_MODEL = process.env.OPENAI_VOICE_PROFILE_MODEL || "gpt-5.4-mini";

const VOICE_PROFILE_SCHEMA = z.object({
  accent: z.string(),
  voiceAffect: z.string(),
  tone: z.string(),
  pacing: z.string(),
  emotion: z.string(),
  delivery: z.string(),
  variety: z.string(),
});

const CLINICIAN_TURN_SCHEMA = z.object({
  text: z.string(),
  technique: z.string(),
  voiceProfile: VOICE_PROFILE_SCHEMA,
});

type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

interface StructuredOutputRequest {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: z.ZodTypeAny;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
}

interface PatientVoiceProfileInput {
  title: string;
  aiRole: string;
  traineeRole: string;
  backstory: string;
  emotionalDriver: string;
  setting: string;
  traits: ScenarioTraits;
  voiceConfig: ScenarioVoiceConfig;
  currentState: EscalationState;
  recentTurns: { speaker: string; content: string }[];
  latestSpeakerVoiceProfile?: StructuredVoiceProfile | null;
  latestSpeakerRole?: "trainee" | "clinician" | null;
}

interface ClinicianTurnInput {
  scenarioContext: string;
  patientRole: string;
  clinicianRole: string;
  emotionalDriver: string;
  escalationState: Partial<EscalationState>;
  recentTurns: { speaker: string; content: string }[];
  patientVoiceProfile?: StructuredVoiceProfile | null;
}

async function requestStructuredOutput<T>({
  systemPrompt,
  userPrompt,
  schemaName,
  schema,
  maxTokens = 600,
  reasoningEffort = "low",
}: StructuredOutputRequest): Promise<T | null> {
  const client = getOpenAIClient();
  if (!client) {
    const error = new Error("OPENAI_API_KEY not configured");
    console.error(`[Structured Voice] schema=${schemaName} output error:`, error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }

  try {
    const response = await client.responses.create({
      model: VOICE_PROFILE_MODEL,
      instructions: systemPrompt,
      input: userPrompt,
      store: false,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: maxTokens,
      text: {
        format: zodTextFormat(schema, schemaName),
        verbosity: "low",
      },
    });

    const parsed = parseStructuredOutputText(response, schema);
    if (!parsed) {
      throw new SyntaxError(
        `[Structured Voice] schema=${schemaName} unable to parse structured JSON (${describeStructuredOutputFailure(response)})`
      );
    }

    return parsed as T;
  } catch (error) {
    console.error(`[Structured Voice] schema=${schemaName} output error:`, error);
    if (shouldFailLoudOnOpenAIError()) {
      throw error;
    }
    return null;
  }
}

function formatRecentTurns(turns: { speaker: string; content: string }[]): string {
  if (turns.length === 0) return "No prior turns.";
  const speakerLabels: Record<string, string> = {
    trainee: "Trainee clinician",
    ai: "Patient or relative",
    system: "AI clinician",
  };
  return turns
    .slice(-10)
    .map((turn) => `${speakerLabels[turn.speaker] || turn.speaker}: ${turn.content}`)
    .join("\n");
}

function formatPatientVoiceProfile(profile?: StructuredVoiceProfile | null): string {
  if (!profile) return "No structured patient voice profile available.";
  return renderVoiceProfileForPrompt(profile);
}

function formatLatestSpeakerVoiceProfile(
  profile?: StructuredVoiceProfile | null,
  role?: "trainee" | "clinician" | null
): string {
  if (!profile) return "No structured delivery profile available for the most recent speaker turn.";
  const roleLabel = role === "trainee"
    ? "the trainee clinician"
    : role === "clinician"
      ? "the AI clinician"
      : "the most recent speaker";
  return `Profile for ${roleLabel}:\n${renderVoiceProfileForPrompt(profile)}`;
}

export async function generatePatientVoiceProfile(
  input: PatientVoiceProfileInput
): Promise<StructuredVoiceProfile | null> {
  const systemPrompt = `You design the spoken voice profile for a simulated patient or relative in a live NHS communication training scenario.

Return only a structured voice profile for the NEXT reply. Do not write dialogue.

The profile must reflect:
- the person's emotional state right now
- how that state has shifted through the conversation
- their personality traits and baseline voice settings
- how escalated, trusting, angry, and willing to listen they currently are
- whether any configured prejudice is currently surfacing
- whether the next turn should sound tense, hostile, abusive, profane, or threatening

Use concrete wording that can be dropped directly into a speech model prompt.
Use British English.
Keep any discriminatory colouring within the authored bias categories only.
Do not clean a highly escalated delivery up into polite neutrality.
Do not rely on angry wording alone. Make the vocal behaviour itself audible through volume, attack, pacing, breath, strain, clippedness, contempt, or emotional leakage when the state justifies it.
If escalation, anger, or frustration rises, the next-turn profile must sound noticeably different from a calmer turn.`;

  const userPrompt = `Scenario title: ${input.title}
Role: ${input.aiRole}
Speaking with: ${input.traineeRole}
Setting: ${input.setting}
Backstory: ${input.backstory}
Emotional driver: ${input.emotionalDriver}

Current state:
- Escalation: ${input.currentState.level}/10
- Trust: ${input.currentState.trust}/10
- Willingness to listen: ${input.currentState.willingness_to_listen}/10
- Anger: ${input.currentState.anger}/10
- Frustration: ${input.currentState.frustration}/10
- Discriminatory behaviour active: ${input.currentState.discrimination_active ? "yes" : "no"}

Traits:
- Hostility: ${input.traits.hostility}/10
- Sarcasm: ${input.traits.sarcasm}/10
- Volatility: ${input.traits.volatility}/10
- Boundary respect: ${input.traits.boundary_respect}/10
- Coherence: ${input.traits.coherence}/10
- Repetition: ${input.traits.repetition}/10
- Entitlement: ${input.traits.entitlement}/10
- Interruption likelihood: ${input.traits.interruption_likelihood}/10
- Bias intensity: ${input.traits.bias_intensity}/10
- Bias categories: ${formatBiasCategories(input.traits.bias_category)}

Base voice config:
- Voice name: ${input.voiceConfig.voice_name}
- Speaking rate: ${input.voiceConfig.speaking_rate}
- Expressiveness: ${input.voiceConfig.expressiveness_level}/10
- Anger expression: ${input.voiceConfig.anger_expression}/10
- Sarcasm expression: ${input.voiceConfig.sarcasm_expression}/10
- Pause style: ${input.voiceConfig.pause_style}
- Interruption style: ${input.voiceConfig.interruption_style}
- Turn pause allowance: +${input.voiceConfig.turn_pause_allowance_ms} ms before taking the turn

Recent turns:
${formatRecentTurns(input.recentTurns)}

Latest delivery profile for the most recent speaker turn:
${formatLatestSpeakerVoiceProfile(input.latestSpeakerVoiceProfile, input.latestSpeakerRole)}

Create a voice profile for the patient's next spoken turn only.

Use all available inputs together:
- the patient's current numeric state
- the recent dialogue
- the latest speaker delivery profile, if provided, because the patient may react differently to the same words when they are delivered more softly, more firmly, more sarcastically, or more urgently.

Additional delivery guidance:
- ${input.currentState.discrimination_active
    ? `Configured prejudice is currently active. The voice should carry contempt and dismissiveness consistent with these categories only: ${formatBiasCategories(input.traits.bias_category)}.`
    : hasConfiguredBias(input.traits)
      ? "Configured prejudice exists but is not fully surfacing yet. Keep it latent rather than constant."
      : "No discriminatory colouring should be present in the delivery."}
- ${input.currentState.level >= 8
    ? "At this state the next turn should sound openly abusive, profane, or intimidating, not merely irritated."
    : input.currentState.level >= 6
      ? "At this state the next turn should sound heated and hostile, with real edge in the delivery."
      : "Keep the delivery aligned with the current state without overshooting into abuse."}
- ${input.currentState.level >= 6 || input.currentState.anger >= 6 || input.currentState.frustration >= 7
    ? "Make the escalation audible. The voice should not sound like the same calm speaker using harsher wording. Use sharper attacks, tighter pacing, reduced warmth, more bite, and more emotional leakage."
    : input.currentState.level >= 4 || input.currentState.anger >= 4 || input.currentState.frustration >= 5
      ? "Let irritation or strain be clearly audible in the voice itself through clipped delivery, firmer stress, shorter patience, or audible exasperation."
      : "Keep the voice grounded and believable without forcing extra heat into it."}
- If the most recent delivery profile suggests the trainee sounded dismissive, sarcastic, cold, or defensive, allow that to harden the next-turn voice profile even if the patient's wording stays brief.`;

  return requestStructuredOutput<StructuredVoiceProfile>({
    systemPrompt,
    userPrompt,
    schemaName: "patient_voice_profile",
    schema: VOICE_PROFILE_SCHEMA,
    maxTokens: 500,
    reasoningEffort: "low",
  });
}

interface TraineeVoiceProfileInput {
  utterance: string;
  scenarioContext: string;
  currentEscalation: number;
  recentTurns: { speaker: string; content: string }[];
}

export async function generateTraineeVoiceProfile(
  input: TraineeVoiceProfileInput
): Promise<StructuredVoiceProfile | null> {
  const systemPrompt = `You are analysing how a trainee clinician sounds in a live NHS communication training simulation.

Given the trainee's latest utterance and recent conversation context, produce a structured voice profile describing how the trainee likely sounded when delivering this line.

Focus on:
- tone (e.g. dismissive, sarcastic, empathetic, defensive, calm, anxious)
- emotional state (e.g. frustrated, composed, flustered, detached)
- delivery style (e.g. clipped, measured, hesitant, rushed, blunt)
- pacing (e.g. fast, slow, uneven)
- voice affect (e.g. flat, warm, tense, aggressive)

Use concrete, specific descriptors. Be honest — if the words sound dismissive or sarcastic in context, say so. If they sound calm and professional, say that.
Use British English.`;

  const userPrompt = `Scenario: ${input.scenarioContext}
Current escalation level: ${input.currentEscalation}/10

Recent conversation:
${formatRecentTurns(input.recentTurns)}

Trainee's latest utterance to profile:
"${input.utterance}"

Describe how this utterance likely sounded based on the words, the conversational context, and the current emotional dynamics.`;

  return requestStructuredOutput<StructuredVoiceProfile>({
    systemPrompt,
    userPrompt,
    schemaName: "trainee_voice_profile",
    schema: VOICE_PROFILE_SCHEMA,
    maxTokens: 300,
    reasoningEffort: "low",
  });
}

export async function generateClinicianTurn(
  input: ClinicianTurnInput
): Promise<StructuredClinicianTurn | null> {
  const systemPrompt = `You are an expert NHS clinician taking over a live de-escalation conversation.

Return a structured object with:
- text: the clinician's next spoken reply
- technique: a short label for the de-escalation technique used
- voiceProfile: how that exact line should be spoken

Rules for the spoken reply:
- natural spoken British English
- 1-3 sentences maximum
- respond to what the patient just said
- use the patient's current emotional and vocal presentation, not just the literal words
- validate and steady the interaction
- do not sound patronising, generic, or scripted

CRITICAL — conversation progression:
- read the full conversation history carefully before responding
- NEVER repeat a commitment, reassurance, or next step you have already given
- if you already promised to check something, your next turn must deliver a realistic update, result, or explanation — not another promise to check
- progress the conversation through natural clinical stages:
  1. validate the concern and commit to a specific action
  2. return with concrete information (synthesise realistic clinical details appropriate to the scenario — e.g. what is causing the delay, what the plan is, what the timeline looks like)
  3. address follow-up questions with specifics
  4. agree a clear plan and check the person is satisfied
- if the patient keeps asking the same question, it means your previous answer was not concrete enough — give more specific information, not more reassurance
- you may invent plausible clinical details (ward names, timelines, specific blockers like pharmacy sign-off or therapy assessment) to move the conversation forward — this is a training simulation, not a real patient interaction

Rules for the voice profile:
- describe how the clinician should sound in this exact moment
- reflect the patient's current emotional state and escalation
- reflect the patient's current voice state and conversational stance
- sound like an experienced UK NHS clinician
- keep the clinician human, responsive, and believable`;

  const state = input.escalationState;
  const userPrompt = `Scenario: ${input.scenarioContext}
Patient role: ${input.patientRole}
Clinician role: ${input.clinicianRole}
Emotional driver: ${input.emotionalDriver}

Current patient state:
- Escalation: ${state.level ?? 5}/10
- Trust: ${state.trust ?? 4}/10
- Willingness to listen: ${state.willingness_to_listen ?? 4}/10
- Anger: ${state.anger ?? 5}/10
- Frustration: ${state.frustration ?? 5}/10

Current structured patient voice profile:
${formatPatientVoiceProfile(input.patientVoiceProfile)}

Conversation so far:
${formatRecentTurns(input.recentTurns)}

Generate the clinician's next spoken turn and the voice profile for how that turn should be delivered.

Use all three inputs together:
- what the patient literally said
- the current patient state values
- the current patient voice profile, which captures how they are emotionally and vocally presenting right now`;

  return requestStructuredOutput<StructuredClinicianTurn>({
    systemPrompt,
    userPrompt,
    schemaName: "clinician_turn_with_voice_profile",
    schema: CLINICIAN_TURN_SCHEMA,
    maxTokens: 650,
    reasoningEffort: "low",
  });
}
