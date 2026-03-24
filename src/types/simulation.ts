export type SessionStatus = "created" | "active" | "completed" | "aborted" | "error";
export type ExitType = "normal" | "instant_exit" | "educator_ended" | "timeout" | "auto_ceiling";
export type Speaker = "trainee" | "ai" | "system";

export type StateEventType =
  | "session_started"
  | "session_ended"
  | "escalation_change"
  | "de_escalation_change"
  | "ceiling_reached"
  | "trainee_exit"
  | "classification_result"
  | "prompt_update"
  | "error";

export interface SimulationSession {
  id: string;
  scenario_id: string;
  trainee_id: string;
  org_id: string;
  status: SessionStatus;
  scenario_snapshot: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  exit_type: ExitType | null;
  trainee_consented_at: string | null;
  final_escalation_level: number | null;
  peak_escalation_level: number | null;
  created_at: string;
}

export interface TranscriptTurn {
  id: string;
  session_id: string;
  turn_index: number;
  speaker: Speaker;
  content: string;
  audio_url: string | null;
  classifier_result: ClassifierResult | null;
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

export interface ClassifierResult {
  technique: string;
  effectiveness: number; // -1.0 to 1.0
  tags: string[];
  confidence: number; // 0-1
  reasoning: string;
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
