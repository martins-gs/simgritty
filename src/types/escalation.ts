export interface EscalationState {
  level: number; // 1-10
  trust: number; // 0-10
  willingness_to_listen: number; // 0-10
  anger: number; // 0-10
  frustration: number; // 0-10
  boundary_respect: number; // 0-10
  discrimination_active: boolean;
  interruptions_count: number;
  validations_count: number;
  unanswered_questions: number;
}

export interface EscalationDelta {
  level_delta: number;
  trust_delta: number;
  listening_delta: number;
  reason: string;
  trigger_type: "escalation" | "de_escalation" | "neutral";
}

export const ESCALATION_LABELS: Record<number, string> = {
  1: "Calm but concerned",
  2: "Guarded",
  3: "Irritated",
  4: "Frustrated",
  5: "Confrontational",
  6: "Accusatory",
  7: "Hostile",
  8: "Verbally abusive",
  9: "Threatening",
  10: "Severe loss of control",
};
