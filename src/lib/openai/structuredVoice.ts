import type { EscalationState } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig } from "@/types/scenario";
import type { StructuredClinicianTurn, StructuredVoiceProfile } from "@/types/voice";
import { renderVoiceProfileForPrompt } from "@/lib/voice/renderVoiceProfile";

const VOICE_PROFILE_MODEL = process.env.OPENAI_VOICE_PROFILE_MODEL || "gpt-4o-mini";

const VOICE_PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    accent: { type: "string" },
    voiceAffect: { type: "string" },
    tone: { type: "string" },
    pacing: { type: "string" },
    emotion: { type: "string" },
    delivery: { type: "string" },
    variety: { type: "string" },
  },
  required: ["accent", "voiceAffect", "tone", "pacing", "emotion", "delivery", "variety"],
} as const;

const CLINICIAN_TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: { type: "string" },
    technique: { type: "string" },
    voiceProfile: VOICE_PROFILE_SCHEMA,
  },
  required: ["text", "technique", "voiceProfile"],
} as const;

interface StructuredOutputRequest {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
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
  temperature = 0.4,
  maxTokens = 600,
}: StructuredOutputRequest): Promise<T | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Structured voice output error: OPENAI_API_KEY not configured");
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOICE_PROFILE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Structured voice output error:", errorText);
    return null;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    console.error("Structured voice output parse error:", error);
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

Use concrete wording that can be dropped directly into a speech model prompt.
Use British English.`;

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

Traits:
- Hostility: ${input.traits.hostility}/10
- Sarcasm: ${input.traits.sarcasm}/10
- Volatility: ${input.traits.volatility}/10
- Boundary respect: ${input.traits.boundary_respect}/10
- Coherence: ${input.traits.coherence}/10
- Repetition: ${input.traits.repetition}/10
- Entitlement: ${input.traits.entitlement}/10
- Interruption likelihood: ${input.traits.interruption_likelihood}/10

Base voice config:
- Voice name: ${input.voiceConfig.voice_name}
- Speaking rate: ${input.voiceConfig.speaking_rate}
- Expressiveness: ${input.voiceConfig.expressiveness_level}/10
- Anger expression: ${input.voiceConfig.anger_expression}/10
- Sarcasm expression: ${input.voiceConfig.sarcasm_expression}/10
- Pause style: ${input.voiceConfig.pause_style}
- Interruption style: ${input.voiceConfig.interruption_style}

Recent turns:
${formatRecentTurns(input.recentTurns)}

Create a voice profile for the patient's next spoken turn only.`;

  return requestStructuredOutput<StructuredVoiceProfile>({
    systemPrompt,
    userPrompt,
    schemaName: "patient_voice_profile",
    schema: VOICE_PROFILE_SCHEMA,
    temperature: 0.3,
    maxTokens: 500,
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
- offer a concrete next step or boundary when appropriate
- do not sound patronising, generic, or scripted

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
    temperature: 0.4,
    maxTokens: 650,
  });
}
