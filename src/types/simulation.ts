import type { EscalationState } from "@/types/escalation";
import type { StructuredVoiceProfile } from "@/types/voice";

export type SessionStatus = "created" | "active" | "completed" | "aborted" | "error";
export type ExitType = "normal" | "instant_exit" | "educator_ended" | "timeout" | "auto_ceiling" | "max_duration";
export type Speaker = "trainee" | "ai" | "system";
export type TurnTriggerType = "escalation" | "de_escalation" | "neutral";

export type StateEventType =
  | "session_started"
  | "session_ended"
  | "escalation_change"
  | "de_escalation_change"
  | "ceiling_reached"
  | "trainee_exit"
  | "classification_result"
  | "clinician_audio"
  | "prompt_update"
  | "error";

export type ClinicianAudioPath = "realtime" | "tts" | "none";
export type ClinicianAudioOutcome = "completed" | "partial" | "failed";

export interface ClinicianAudioPayload {
  source: "bot_clinician";
  turn_index: number;
  technique: string;
  path: ClinicianAudioPath;
  realtime_outcome: ClinicianAudioOutcome | null;
  fallback_reason: string | null;
  renderer_error: string | null;
  elapsed_ms: number | null;
}

export interface SimulationSession {
  id: string;
  scenario_id: string;
  trainee_id: string;
  org_id: string;
  parent_session_id: string | null;
  forked_from_session_id: string | null;
  forked_from_turn_index: number | null;
  fork_label: string | null;
  branch_depth: number | null;
  status: SessionStatus;
  scenario_snapshot: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  exit_type: ExitType | null;
  trainee_consented_at: string | null;
  final_escalation_level: number | null;
  peak_escalation_level: number | null;
  recording_path: string | null;
  recording_started_at?: string | null;
  review_summary?: Record<string, unknown> | null;
  review_artifacts?: Record<string, unknown> | null;
  created_at: string;
  scenario_templates?: {
    title?: string;
    setting?: string;
    ai_role?: string;
    trainee_role?: string;
    difficulty?: string;
  } | null;
}

export interface TranscriptTurn {
  id: string;
  session_id: string;
  turn_index: number;
  speaker: Speaker;
  content: string;
  audio_url: string | null;
  classifier_result: ClassifierResult | null;
  trainee_delivery_analysis: TraineeDeliveryAnalysis | null;
  trigger_type: TurnTriggerType | null;
  state_after: EscalationState | null;
  patient_voice_profile_after: StructuredVoiceProfile | null;
  patient_prompt_after: string | null;
  started_at: string;
  duration_ms: number | null;
}

export interface SimulationStateEvent {
  id: string;
  session_id: string;
  event_index: number;
  event_type: StateEventType;
  escalation_before: number | null;
  escalation_after: number | null;
  trust_before: number | null;
  trust_after: number | null;
  listening_before: number | null;
  listening_after: number | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export type ComposureMarker =
  | "defensive_language"
  | "dismissive_response"
  | "hostility_mirroring"
  | "sarcasm"
  | "interruption";

export type DeEscalationTechnique =
  | "validation"
  | "empathy"
  | "reframing"
  | "concrete_help"
  | "naming_emotion"
  | "open_question";

export type TraineeDeliveryMarker =
  | "calm_measured"
  | "warm_empathic"
  | "tense_hurried"
  | "flat_detached"
  | "defensive_tone"
  | "sarcastic_tone"
  | "irritated_tone"
  | "hostile_tone"
  | "anxious_unsteady";

export interface TraineeDeliveryAnalysis {
  source: "audio";
  confidence: number;
  summary: string;
  markers: TraineeDeliveryMarker[];
  acousticEvidence: string[];
  duration_ms: number | null;
  voiceProfile: StructuredVoiceProfile;
}

export type SessionDeliveryTrend = "improving" | "worsening" | "steady" | "mixed";

export interface SessionDeliveryAnalysis {
  source: "session_audio";
  confidence: number;
  supported: boolean;
  summary: string | null;
  markers: TraineeDeliveryMarker[];
  evidenceTurnIndexes: number[];
  trend: SessionDeliveryTrend | null;
  acousticEvidence: string[];
}

export interface ClassifierResult {
  technique: string;
  effectiveness: number; // -1.0 to 1.0
  tags: string[];
  confidence: number; // 0-1
  reasoning: string;
  // Scoring fields (present on trainee_utterance classifications)
  composure_markers?: ComposureMarker[];
  de_escalation_attempt?: boolean;
  de_escalation_technique?: DeEscalationTechnique | null;
  clinical_milestone_completed?: string | null;
  trainee_delivery_analysis?: TraineeDeliveryAnalysis | null;
}

export interface EducatorNote {
  id: string;
  session_id: string;
  author_id: string;
  content: string;
  turn_id: string | null;
  created_at: string;
  updated_at: string;
}

export type QualitativeLabel = "Strong" | "Developing" | "Needs practice";
export type ScoringDimension = "composure" | "de_escalation" | "clinical_task" | "support_seeking";

export interface SessionScore {
  id: string;
  session_id: string;
  composure_score: number;
  de_escalation_score: number;
  clinical_task_score: number | null;
  support_seeking_score: number;
  overall_score: number;
  qualitative_label: QualitativeLabel;
  weights_used: Record<string, number>;
  session_valid: boolean;
  turn_count: number;
  created_at: string;
}

export interface SessionScoreEvidence {
  id: string;
  session_id: string;
  dimension: ScoringDimension;
  turn_index: number;
  evidence_type: string;
  evidence_data: Record<string, unknown>;
  score_impact: number;
  created_at: string;
}

export interface SessionReflection {
  id: string;
  session_id: string;
  user_id: string;
  tags: string[];
  free_text: string | null;
  created_at: string;
  updated_at?: string | null;
}
