import type { ClinicianVoiceContext } from "@/lib/engine/clinicianVoiceBuilder";
import type { EscalationState } from "@/types/escalation";
import {
  DEFAULT_ESCALATION_RULES,
  DEFAULT_TRAITS,
  DEFAULT_VOICE_CONFIG,
  type EscalationRules,
  type ScenarioMilestone,
  type ScenarioTraits,
  type ScenarioVoiceConfig,
  type ScoringWeights,
} from "@/types/scenario";
import type {
  ClassifierResult,
  ClinicianAudioPayload,
  EducatorNote,
  SessionReflection,
  SimulationSession,
  SimulationStateEvent,
  TraineeDeliveryAnalysis,
  TranscriptTurn,
} from "@/types/simulation";
import type { StructuredVoiceProfile } from "@/types/voice";
import { z } from "zod";

const looseObjectSchema = z.object({}).catchall(z.unknown());

const recentTurnSchema = z.object({
  speaker: z.string().min(1),
  content: z.string(),
});

const scenarioMilestoneIdSchema = z.string().min(1);
const speakerSchema = z.enum(["trainee", "ai", "system"]);
const turnTriggerTypeSchema = z.enum(["escalation", "de_escalation", "neutral"]);
const sessionStatusSchema = z.enum(["created", "active", "completed", "aborted", "error"]);
const exitTypeSchema = z.enum(["normal", "instant_exit", "educator_ended", "timeout", "auto_ceiling", "max_duration"]);
const stateEventTypeSchema = z.enum([
  "session_started",
  "session_ended",
  "escalation_change",
  "de_escalation_change",
  "ceiling_reached",
  "trainee_exit",
  "classification_result",
  "clinician_audio",
  "prompt_update",
  "error",
]);
const clinicianAudioPathSchema = z.enum(["realtime", "tts", "none"]);
const clinicianAudioOutcomeSchema = z.enum(["completed", "partial", "failed"]);

const nullableStringSchema = z.string().nullish().transform((value) => value ?? null).catch(null);
const nullableNumberSchema = z.number().nullish().transform((value) => value ?? null).catch(null);
const nullableIntSchema = z.number().int().nullish().transform((value) => value ?? null).catch(null);

export const structuredVoiceProfileSchema = z.object({
  accent: z.string(),
  voiceAffect: z.string(),
  tone: z.string(),
  pacing: z.string(),
  emotion: z.string(),
  delivery: z.string(),
  variety: z.string(),
});

export const escalationStateSchema = z.object({
  level: z.number().int().min(1).max(10),
  trust: z.number().min(0).max(10),
  willingness_to_listen: z.number().min(0).max(10),
  anger: z.number().min(0).max(10),
  frustration: z.number().min(0).max(10),
  boundary_respect: z.number().min(0).max(10),
  discrimination_active: z.boolean(),
  interruptions_count: z.number().int().min(0),
  validations_count: z.number().int().min(0),
  unanswered_questions: z.number().int().min(0),
});

const composureMarkerSchema = z.enum([
  "defensive_language",
  "dismissive_response",
  "hostility_mirroring",
  "sarcasm",
  "interruption",
]);

const deEscalationTechniqueSchema = z.enum([
  "validation",
  "empathy",
  "reframing",
  "concrete_help",
  "naming_emotion",
  "open_question",
]);

const traineeDeliveryMarkerSchema = z.enum([
  "calm_measured",
  "warm_empathic",
  "tense_hurried",
  "flat_detached",
  "defensive_tone",
  "sarcastic_tone",
  "irritated_tone",
  "hostile_tone",
  "anxious_unsteady",
]);

export const traineeDeliveryAnalysisSchema: z.ZodType<TraineeDeliveryAnalysis> = z.object({
  source: z.literal("audio"),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  markers: z.array(traineeDeliveryMarkerSchema),
  acousticEvidence: z.array(z.string()),
  duration_ms: nullableNumberSchema,
  voiceProfile: structuredVoiceProfileSchema,
});

export const classifierResultSchema = z.object({
  technique: z.string(),
  effectiveness: z.number(),
  tags: z.array(z.string()),
  confidence: z.number(),
  reasoning: z.string(),
  composure_markers: z.array(composureMarkerSchema).optional(),
  de_escalation_attempt: z.boolean().optional(),
  de_escalation_technique: deEscalationTechniqueSchema.nullable().optional(),
  clinical_milestone_completed: scenarioMilestoneIdSchema.nullable().optional(),
  trainee_delivery_analysis: traineeDeliveryAnalysisSchema.nullable().optional(),
});

export const scenarioTraitsSchema = z.object({
  hostility: z.number().min(0).max(10),
  frustration: z.number().min(0).max(10),
  impatience: z.number().min(0).max(10),
  trust: z.number().min(0).max(10),
  willingness_to_listen: z.number().min(0).max(10),
  sarcasm: z.number().min(0).max(10),
  bias_intensity: z.number().min(0).max(10),
  bias_category: z.string().default("none"),
  volatility: z.number().min(0).max(10),
  boundary_respect: z.number().min(0).max(10),
  coherence: z.number().min(0).max(10),
  repetition: z.number().min(0).max(10),
  entitlement: z.number().min(0).max(10),
  interruption_likelihood: z.number().min(0).max(10),
  escalation_tendency: z.number().min(0).max(10),
});

export const scenarioVoiceConfigSchema = z.object({
  voice_name: z.string().default("alloy"),
  speaking_rate: z.number().min(0.5).max(2),
  expressiveness_level: z.number().min(0).max(10),
  anger_expression: z.number().min(0).max(10),
  sarcasm_expression: z.number().min(0).max(10),
  pause_style: z.enum(["natural", "short_clipped", "long_dramatic", "minimal"]),
  interruption_style: z.enum(["none", "occasional", "frequent", "aggressive"]),
  turn_pause_allowance_ms: z.number().int().min(0).max(1500).default(0),
});

const escalationTriggerSchema = z.object({
  trigger: z.string(),
  delta: z.number(),
});

export const escalationRulesSchema = z.object({
  initial_level: z.number().min(1).max(10),
  max_ceiling: z.number().min(1).max(10),
  auto_end_threshold: z.number().min(1).max(10).nullable(),
  escalation_triggers: z.array(escalationTriggerSchema).default([]),
  deescalation_triggers: z.array(escalationTriggerSchema).default([]),
});

export const scoringWeightsSchema = z.object({
  composure: z.number().min(0).max(1),
  de_escalation: z.number().min(0).max(1),
  clinical_task: z.number().min(0).max(1),
  support_seeking: z.number().min(0).max(1),
});

export const scenarioMilestoneInputSchema = z.object({
  description: z.string().min(1).max(100),
  classifier_hint: z.string().max(300).default(""),
});

export const scenarioMilestoneSchema = z.object({
  id: z.string(),
  scenario_template_id: z.string(),
  order: z.number().int().nonnegative(),
  description: z.string().min(1).max(100),
  classifier_hint: z.string().max(300).default(""),
  created_at: z.string(),
});

export const scenarioUpsertBodySchema = z.object({
  title: z.string().min(1),
  setting: z.string().default(""),
  trainee_role: z.string().default(""),
  ai_role: z.string().default(""),
  backstory: z.string().default(""),
  emotional_driver: z.string().default(""),
  difficulty: z.enum(["low", "moderate", "high", "extreme"]).default("moderate"),
  archetype_tag: z.string().nullable().default(null),
  learning_objectives: z.string().default(""),
  pre_simulation_briefing_text: z.string().default(""),
  content_warning_text: z.string().default(""),
  educator_facilitation_recommended: z.boolean().default(false),
  support_threshold: z.number().int().min(1).max(10).nullable().default(null),
  critical_threshold: z.number().int().min(1).max(10).nullable().default(null),
  scoring_weights: scoringWeightsSchema.nullable().default(null),
  milestones: z.array(scenarioMilestoneInputSchema).max(10).default([]),
  traits: scenarioTraitsSchema,
  voice_config: scenarioVoiceConfigSchema,
  escalation_rules: escalationRulesSchema,
  publish: z.boolean().default(false),
});

const milestoneContextSchema = z.object({
  id: scenarioMilestoneIdSchema,
  description: z.string(),
  classifier_hint: z.string(),
});

export const classifierContextSchema = z.object({
  recentTurns: z.array(recentTurnSchema).default([]),
  scenarioContext: z.string().min(1),
  currentEscalation: z.number().int().min(0).max(10),
  speakerVoiceProfile: structuredVoiceProfileSchema.nullable().optional(),
  milestones: z.array(milestoneContextSchema).optional(),
});

export const classifyRequestBodySchema = z.object({
  utterance: z.string().min(1),
  context: classifierContextSchema,
  mode: z.enum(["trainee_utterance", "patient_response", "clinician_utterance"]).optional(),
});

export const deescalateRequestBodySchema = z.object({
  recentTurns: z.array(recentTurnSchema).default([]),
  scenarioContext: z.string().default("NHS de-escalation scenario"),
  emotionalDriver: z.string().default(""),
  patientRole: z.string().default("patient"),
  clinicianRole: z.string().default("experienced British NHS clinician"),
  escalationState: escalationStateSchema.partial().default({}),
  patientVoiceProfile: structuredVoiceProfileSchema.nullable().default(null),
});

export const patientVoiceProfileRequestBodySchema = z.object({
  title: z.string().default("Simulation scenario"),
  aiRole: z.string().default("Patient"),
  traineeRole: z.string().default("Clinician"),
  backstory: z.string().default(""),
  emotionalDriver: z.string().default(""),
  setting: z.string().default(""),
  traits: scenarioTraitsSchema,
  voiceConfig: scenarioVoiceConfigSchema,
  currentState: escalationStateSchema,
  recentTurns: z.array(recentTurnSchema).default([]),
  latestClinicianVoiceProfile: structuredVoiceProfileSchema.nullable().optional(),
});

export const traineeVoiceProfileRequestBodySchema = z.object({
  utterance: z.string().min(1),
  scenarioContext: z.string().default("NHS communication scenario"),
  currentEscalation: z.number().min(0).max(10).default(3),
  recentTurns: z.array(recentTurnSchema).default([]),
});

export const traineeDeliveryAnalysisRequestBodySchema = z.object({
  utterance: z.string().min(1),
  scenarioContext: z.string().default("NHS communication scenario"),
  currentEscalation: z.number().min(0).max(10).default(3),
  recentTurns: z.array(recentTurnSchema).default([]),
  audioBase64: z.string().min(1),
  durationMs: z.number().int().nonnegative().nullable().optional(),
});

const clinicianStateSnapshotSchema = escalationStateSchema
  .pick({
    level: true,
    trust: true,
    willingness_to_listen: true,
    anger: true,
    frustration: true,
  })
  .partial();

export const clinicianVoiceContextSchema: z.ZodType<ClinicianVoiceContext> = z.object({
  clinicianRole: z.string().optional(),
  patientRole: z.string().optional(),
  emotionalDriver: z.string().optional(),
  deescalationTechnique: z.string().optional(),
  escalationState: clinicianStateSnapshotSchema.optional(),
});

export const ttsRequestBodySchema = z.object({
  text: z.string().min(1),
  voice: z.string().optional(),
  style: z.enum(["default", "clinician"]).optional(),
  context: clinicianVoiceContextSchema.optional(),
  voiceProfile: structuredVoiceProfileSchema.nullable().optional(),
});

export const realtimeSessionRequestBodySchema = z.object({
  voice: z.string().optional(),
  instructions: z.string().optional(),
  outputOnly: z.boolean().optional(),
  turnPauseAllowanceMs: z.number().int().min(0).max(1500).optional(),
});

export const createSessionRequestBodySchema = z.object({
  scenario_id: z.string().min(1),
});

export const orgSettingsUpdateRequestBodySchema = z.object({
  allow_discriminatory_content: z.boolean(),
  max_escalation_ceiling: z.number().int().min(1).max(10),
  max_session_duration_minutes: z.number().int().min(1).max(120),
  require_consent_gate: z.boolean(),
});

export const educatorNoteRequestBodySchema = z.object({
  content: z.string(),
  turn_id: z.string().nullable().optional(),
});

export const reflectionRequestBodySchema = z.object({
  tags: z.array(z.string()).default([]),
  free_text: z.string().optional(),
});

export const transcriptTurnCreateRequestBodySchema = z.object({
  turn_index: z.number().int().nonnegative(),
  speaker: speakerSchema,
  content: z.string(),
  audio_url: z.string().nullable().optional(),
  classifier_result: classifierResultSchema.nullable().optional(),
  trainee_delivery_analysis: traineeDeliveryAnalysisSchema.nullable().optional(),
  trigger_type: turnTriggerTypeSchema.nullable().optional(),
  state_after: escalationStateSchema.nullable().optional(),
  patient_voice_profile_after: structuredVoiceProfileSchema.nullable().optional(),
  patient_prompt_after: z.string().nullable().optional(),
  started_at: z.string().optional(),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
});

export const transcriptTurnPatchRequestBodySchema = z.object({
  turn_index: z.number().int().nonnegative(),
  classifier_result: classifierResultSchema.nullable().optional(),
  trainee_delivery_analysis: traineeDeliveryAnalysisSchema.nullable().optional(),
  trigger_type: turnTriggerTypeSchema.nullable().optional(),
  state_after: escalationStateSchema.nullable().optional(),
  patient_voice_profile_after: structuredVoiceProfileSchema.nullable().optional(),
  patient_prompt_after: z.string().nullable().optional(),
});

export const sessionEventRequestBodySchema = z.object({
  event_index: z.number().int().nonnegative(),
  event_type: stateEventTypeSchema,
  escalation_before: z.number().nullable().optional(),
  escalation_after: z.number().nullable().optional(),
  trust_before: z.number().nullable().optional(),
  trust_after: z.number().nullable().optional(),
  listening_before: z.number().nullable().optional(),
  listening_after: z.number().nullable().optional(),
  payload: looseObjectSchema.optional().default({}),
});

export const forkSessionRequestBodySchema = z.object({
  turn_index: z.number().int().nonnegative(),
  fork_label: z.string().optional(),
});

export const endSessionRequestBodySchema = z.object({
  exit_type: exitTypeSchema.default("normal"),
  final_escalation_level: z.number().int().nullable().optional(),
  peak_escalation_level: z.number().int().nullable().optional(),
});

const scenarioTemplatesSummarySchema = z.object({
  title: z.string().optional(),
  setting: z.string().optional(),
  ai_role: z.string().optional(),
  trainee_role: z.string().optional(),
  difficulty: z.string().optional(),
});

export const simulationSessionSchema: z.ZodType<SimulationSession> = z.object({
  id: z.string(),
  scenario_id: z.string(),
  trainee_id: z.string(),
  org_id: z.string(),
  parent_session_id: nullableStringSchema,
  forked_from_session_id: nullableStringSchema,
  forked_from_turn_index: nullableIntSchema,
  fork_label: nullableStringSchema,
  branch_depth: nullableIntSchema,
  status: sessionStatusSchema.catch("error"),
  scenario_snapshot: looseObjectSchema.catch({}),
  started_at: nullableStringSchema,
  ended_at: nullableStringSchema,
  exit_type: exitTypeSchema.nullish().transform((value) => value ?? null).catch(null),
  trainee_consented_at: nullableStringSchema,
  final_escalation_level: nullableNumberSchema,
  peak_escalation_level: nullableNumberSchema,
  recording_path: nullableStringSchema,
  recording_started_at: nullableStringSchema.optional(),
  review_summary: looseObjectSchema.nullish().transform((value) => value ?? null).catch(null),
  created_at: z.string(),
  scenario_templates: scenarioTemplatesSummarySchema.nullable().optional(),
});

export const transcriptTurnSchema: z.ZodType<TranscriptTurn> = z.object({
  id: z.string(),
  session_id: z.string(),
  turn_index: z.number().int().nonnegative(),
  speaker: speakerSchema.catch("ai"),
  content: z.string(),
  audio_url: nullableStringSchema,
  classifier_result: classifierResultSchema.nullish().transform((value) => value ?? null).catch(null),
  trainee_delivery_analysis: traineeDeliveryAnalysisSchema.nullish().transform((value) => value ?? null).catch(null),
  trigger_type: turnTriggerTypeSchema.nullish().transform((value) => value ?? null).catch(null),
  state_after: escalationStateSchema.nullish().transform((value) => value ?? null).catch(null),
  patient_voice_profile_after: structuredVoiceProfileSchema.nullish().transform((value) => value ?? null).catch(null),
  patient_prompt_after: nullableStringSchema,
  started_at: z.string(),
  duration_ms: nullableNumberSchema,
});

export const simulationStateEventSchema: z.ZodType<SimulationStateEvent> = z.object({
  id: z.string(),
  session_id: z.string(),
  event_index: z.number().int().nonnegative(),
  event_type: stateEventTypeSchema.catch("error"),
  escalation_before: nullableNumberSchema,
  escalation_after: nullableNumberSchema,
  trust_before: nullableNumberSchema,
  trust_after: nullableNumberSchema,
  listening_before: nullableNumberSchema,
  listening_after: nullableNumberSchema,
  payload: looseObjectSchema.catch({}),
  created_at: z.string(),
});

export const educatorNoteSchema: z.ZodType<EducatorNote> = z.object({
  id: z.string(),
  session_id: z.string(),
  author_id: z.string(),
  content: z.string(),
  turn_id: nullableStringSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export const sessionReflectionSchema: z.ZodType<SessionReflection> = z.object({
  id: z.string(),
  session_id: z.string(),
  user_id: z.string(),
  tags: z.array(z.string()).default([]),
  free_text: nullableStringSchema,
  created_at: z.string(),
  updated_at: nullableStringSchema.optional(),
});

const clinicianAudioPayloadParseSchema = z.object({
  source: z.literal("bot_clinician").default("bot_clinician"),
  turn_index: z.number().int().nonnegative(),
  technique: z.string().default(""),
  path: clinicianAudioPathSchema.default("none"),
  realtime_outcome: clinicianAudioOutcomeSchema.nullish().transform((value) => value ?? null).catch(null),
  fallback_reason: nullableStringSchema.default(null),
  renderer_error: nullableStringSchema.default(null),
  elapsed_ms: z.number().nonnegative().nullish().transform((value) => value ?? null).catch(null),
});

const scenarioSnapshotScalarsSchema = z.object({
  title: z.string().catch("Simulation"),
  setting: z.string().catch(""),
  trainee_role: z.string().catch(""),
  ai_role: z.string().catch(""),
  backstory: z.string().catch(""),
  emotional_driver: z.string().catch(""),
  learning_objectives: z.string().catch(""),
  support_threshold: z.number().int().min(1).max(10).nullish().transform((value) => value ?? null).catch(null),
  critical_threshold: z.number().int().min(1).max(10).nullish().transform((value) => value ?? null).catch(null),
  scoring_weights: scoringWeightsSchema.nullish().transform((value) => value ?? null).catch(null),
});

export interface ValidatedScenarioSnapshot {
  title: string;
  setting: string;
  trainee_role: string;
  ai_role: string;
  backstory: string;
  emotional_driver: string;
  learning_objectives: string;
  support_threshold: number | null;
  critical_threshold: number | null;
  scoring_weights: ScoringWeights | null;
  scenario_traits: ScenarioTraits[];
  scenario_voice_config: ScenarioVoiceConfig[];
  escalation_rules: EscalationRules[];
  scenario_milestones: ScenarioMilestone[];
}

function parseLooseObject(data: unknown): Record<string, unknown> {
  const parsed = looseObjectSchema.safeParse(data);
  return parsed.success ? parsed.data : {};
}

function toRelationItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data == null) return [];
  return [data];
}

function parseRelationObject<T>(data: unknown, schema: z.ZodType<T>, fallback: T): T {
  const candidate = toRelationItems(data)[0];
  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : fallback;
}

function parseArray<T>(data: unknown, schema: z.ZodType<T>): T[] {
  return toRelationItems(data).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function parseSimulationSession(data: unknown): SimulationSession | null {
  const parsed = simulationSessionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseTranscriptTurns(data: unknown): TranscriptTurn[] {
  return parseArray(data, transcriptTurnSchema);
}

export function parseSimulationEvents(data: unknown): SimulationStateEvent[] {
  return parseArray(data, simulationStateEventSchema);
}

export function parseEducatorNotes(data: unknown): EducatorNote[] {
  return parseArray(data, educatorNoteSchema);
}

export function parseSessionReflection(data: unknown): SessionReflection | null {
  const parsed = sessionReflectionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseClassifierResult(data: unknown): ClassifierResult | null {
  const parsed = classifierResultSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseTraineeDeliveryAnalysis(data: unknown): TraineeDeliveryAnalysis | null {
  const parsed = traineeDeliveryAnalysisSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseStructuredVoiceProfile(data: unknown): StructuredVoiceProfile | null {
  const parsed = structuredVoiceProfileSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseClinicianAudioPayload(data: unknown): ClinicianAudioPayload | null {
  const parsed = clinicianAudioPayloadParseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function getStoredEventKind(data: unknown): string | null {
  const record = parseLooseObject(data);
  return typeof record.__event_kind === "string" ? record.__event_kind : null;
}

export function getClassifierReasoningFromEventPayload(data: unknown): string | null {
  const record = parseLooseObject(data);
  const classifier = parseLooseObject(record.classifier);
  return typeof classifier.reasoning === "string" ? classifier.reasoning : null;
}

export function parseScenarioSnapshot(data: unknown): ValidatedScenarioSnapshot {
  const record = parseLooseObject(data);
  const scalars = scenarioSnapshotScalarsSchema.parse(record);

  return {
    ...scalars,
    scenario_traits: [parseRelationObject(record.scenario_traits, scenarioTraitsSchema, DEFAULT_TRAITS)],
    scenario_voice_config: [parseRelationObject(record.scenario_voice_config, scenarioVoiceConfigSchema, DEFAULT_VOICE_CONFIG)],
    escalation_rules: [parseRelationObject(record.escalation_rules, escalationRulesSchema, DEFAULT_ESCALATION_RULES)],
    scenario_milestones: parseArray(record.scenario_milestones, scenarioMilestoneSchema),
  };
}

export function parseStringIdRecord(data: unknown): { id: string } | null {
  const parsed = z.object({ id: z.string() }).safeParse(data);
  return parsed.success ? parsed.data : null;
}

export type ParsedEscalationState = EscalationState;
export type ParsedStructuredVoiceProfile = StructuredVoiceProfile;
