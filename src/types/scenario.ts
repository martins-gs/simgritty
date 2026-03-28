export type Difficulty = "low" | "moderate" | "high" | "extreme";
export type ScenarioStatus = "draft" | "published" | "archived";
// Single value ("gender"), comma-separated ("gender,racial,age"), or "none"
export type BiasCategory = string;

export interface ScenarioTraits {
  hostility: number;
  frustration: number;
  impatience: number;
  trust: number;
  willingness_to_listen: number;
  sarcasm: number;
  bias_intensity: number;
  bias_category: BiasCategory;
  volatility: number;
  boundary_respect: number;
  coherence: number;
  repetition: number;
  entitlement: number;
  interruption_likelihood: number;
  escalation_tendency: number;
}

export interface ScenarioVoiceConfig {
  voice_name: string;
  speaking_rate: number; // 0.5-2.0
  expressiveness_level: number; // 0-10
  anger_expression: number; // 0-10
  sarcasm_expression: number; // 0-10
  pause_style: "natural" | "short_clipped" | "long_dramatic" | "minimal";
  interruption_style: "none" | "occasional" | "frequent" | "aggressive";
}

export interface EscalationRules {
  initial_level: number; // 1-10
  max_ceiling: number; // 1-10
  auto_end_threshold: number | null; // 1-10 or null
  escalation_triggers: EscalationTrigger[];
  deescalation_triggers: EscalationTrigger[];
}

export interface EscalationTrigger {
  trigger: string;
  delta: number;
}

export interface ScoringWeights {
  composure: number;
  de_escalation: number;
  clinical_task: number;
  support_seeking: number;
}

export interface ScenarioMilestone {
  id: string;
  scenario_template_id: string;
  order: number;
  description: string;
  classifier_hint: string;
  created_at: string;
}

export interface ScenarioTemplate {
  id: string;
  org_id: string;
  created_by: string;
  title: string;
  setting: string;
  trainee_role: string;
  ai_role: string;
  backstory: string;
  emotional_driver: string;
  difficulty: Difficulty;
  archetype_tag: string | null;
  status: ScenarioStatus;
  is_template: boolean;
  learning_objectives: string;
  pre_simulation_briefing_text: string;
  content_warning_text: string;
  educator_facilitation_recommended: boolean;
  post_simulation_reflection_prompts: string[];
  // Scoring configuration
  scoring_weights: ScoringWeights | null;
  support_threshold: number | null;
  critical_threshold: number | null;
  clinical_task_enabled: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  traits?: ScenarioTraits;
  voice_config?: ScenarioVoiceConfig;
  escalation_rules?: EscalationRules;
  scenario_milestones?: ScenarioMilestone[];
}

export const DEFAULT_TRAITS: ScenarioTraits = {
  hostility: 3,
  frustration: 5,
  impatience: 5,
  trust: 5,
  willingness_to_listen: 5,
  sarcasm: 3,
  bias_intensity: 0,
  bias_category: "none",
  volatility: 3,
  boundary_respect: 5,
  coherence: 7,
  repetition: 3,
  entitlement: 3,
  interruption_likelihood: 3,
  escalation_tendency: 5,
};

export const DEFAULT_VOICE_CONFIG: ScenarioVoiceConfig = {
  voice_name: "marin",
  speaking_rate: 1.0,
  expressiveness_level: 5,
  anger_expression: 3,
  sarcasm_expression: 2,
  pause_style: "natural",
  interruption_style: "none",
};

export const DEFAULT_ESCALATION_RULES: EscalationRules = {
  initial_level: 3,
  max_ceiling: 8,
  auto_end_threshold: null,
  escalation_triggers: [],
  deescalation_triggers: [],
};
