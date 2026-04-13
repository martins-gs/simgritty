export const EDUCATOR_TEACHING_THEMES = [
  "addressing_distress_early",
  "listening_and_attention",
  "answering_the_core_concern",
  "handling_uncertainty_clearly",
  "maintaining_composure_under_pressure",
  "avoiding_defensive_or_self_focused_language",
  "giving_credible_reassurance",
  "repairing_after_a_missed_moment",
  "boundary_setting_under_hostility_or_microaggression",
  "seeking_support_appropriately",
] as const;

export type EducatorTeachingTheme = (typeof EDUCATOR_TEACHING_THEMES)[number];

export const EDUCATOR_THEME_LABELS: Record<EducatorTeachingTheme, string> = {
  addressing_distress_early: "Addressing Distress Early",
  listening_and_attention: "Listening and Attention",
  answering_the_core_concern: "Answering the Core Concern",
  handling_uncertainty_clearly: "Handling Uncertainty Clearly",
  maintaining_composure_under_pressure: "Maintaining Composure Under Pressure",
  avoiding_defensive_or_self_focused_language: "Avoiding Defensive or Self-Focused Language",
  giving_credible_reassurance: "Giving Credible Reassurance",
  repairing_after_a_missed_moment: "Repairing After a Missed Moment",
  boundary_setting_under_hostility_or_microaggression: "Boundary Setting Under Hostility or Microaggression",
  seeking_support_appropriately: "Seeking Support Appropriately",
};

export const EDUCATOR_STAGE_ORDER = [
  "opening",
  "first_substantive_response",
  "after_repeated_challenge",
  "after_direct_hostility",
  "after_explicit_discriminatory_remark",
  "repair_attempt",
  "close",
] as const;

export type EducatorConversationStage = (typeof EDUCATOR_STAGE_ORDER)[number];

export const EDUCATOR_STAGE_LABELS: Record<EducatorConversationStage, string> = {
  opening: "Opening",
  first_substantive_response: "First Substantive Response",
  after_repeated_challenge: "After Repeated Challenge",
  after_direct_hostility: "After Direct Hostility",
  after_explicit_discriminatory_remark: "After Explicit Discriminatory Remark",
  repair_attempt: "Repair Attempt",
  close: "Close",
};

export type EducatorAttemptView = "all" | "first" | "repeat";
export type EducatorPriorityLevel = "high" | "medium" | "low";
export type EducatorTrend = "improving" | "static" | "worsening";

export interface EducatorAnalyticsFiltersInput {
  scenario_id: string | null;
  scenario_type: string | null;
  date_from: string | null;
  date_to: string | null;
  attempt_view: EducatorAttemptView;
  prompt_version: string | null;
}

export interface EducatorAnalyticsFiltersApplied {
  cohort: string | null;
  profession_grade: string | null;
  scenario: string | null;
  scenario_type: string | null;
  date_range: string | null;
  first_attempt_vs_repeat_attempts: EducatorAttemptView;
  site_programme: string | null;
  educator_facilitator: string | null;
  prompt_version: string | null;
}

export interface EducatorPopulationSummary {
  learners: number;
  sessions: number;
  scenarios: number;
  avg_attempts_per_learner: number;
  comparison_group: string;
}

export interface EducatorRepresentativeEvidence {
  scenario: string;
  before: string;
  learner_turn: string;
  after: string;
  why_it_counts_as_this_theme: string;
}

export interface EducatorTopStruggleArea {
  theme: EducatorTeachingTheme;
  priority_rank: number;
  priority_level: EducatorPriorityLevel;
  why_this_matters: string;
  learner_prevalence_pct: number;
  session_prevalence_pct: number;
  avg_impact_summary: string;
  repeat_persistence_summary: string;
  most_common_conversation_stage: string;
  most_affected_scenarios: string[];
  baseline_delta_summary: string;
  typical_behaviours_seen: string[];
  representative_evidence: EducatorRepresentativeEvidence[];
  what_to_emphasise_in_class: string;
  suggested_practice_drill: string;
  future_scenario_gap: string;
}

export interface EducatorTakeaways {
  top_3_teaching_priorities: string[];
  skills_to_reinforce_with_micro_drills: string[];
  skills_better_taught_with_new_scenarios: string[];
  recommended_debrief_focus: string;
}

export interface EducatorAnalyticsReport {
  filters_applied: EducatorAnalyticsFiltersApplied;
  population_summary: EducatorPopulationSummary;
  top_struggle_areas: EducatorTopStruggleArea[];
  cross_cutting_patterns: string[];
  strengths_to_build_on: string[];
  scenario_design_issues: string[];
  data_quality_flags: string[];
  educator_takeaways: EducatorTakeaways;
}

export interface EducatorFilterOption {
  value: string;
  label: string;
}

export interface EducatorAnalyticsAvailableFilters {
  cohort_label: string | null;
  profession_grade_available: boolean;
  site_programme_label: string | null;
  educator_facilitator_available: boolean;
  scenarios: EducatorFilterOption[];
  scenario_types: EducatorFilterOption[];
  prompt_versions: EducatorFilterOption[];
  min_date: string | null;
  max_date: string | null;
}

export interface EducatorHeadlineCard {
  title: string;
  theme: EducatorTeachingTheme | null;
  label: string | null;
  summary: string;
}

export interface EducatorPriorityMatrixPoint {
  theme: EducatorTeachingTheme;
  label: string;
  priority_rank: number;
  priority_level: EducatorPriorityLevel;
  learner_prevalence_pct: number;
  avg_impact_score: number;
  persistence_pct: number;
  trend: EducatorTrend;
}

export interface EducatorHeatmapCell {
  scenario: string;
  theme: EducatorTeachingTheme;
  prevalence_pct: number;
  priority_score: number;
}

export interface EducatorStageBreakdownItem {
  stage: EducatorConversationStage;
  label: string;
  count: number;
  pct: number;
}

export interface EducatorEvidenceDrawerExample {
  scenario: string;
  before: string;
  learner_turn: string;
  after: string;
  why_it_matters: string;
  better_alternative: string;
}

export interface EducatorEvidenceDrawer {
  theme: EducatorTeachingTheme;
  label: string;
  examples: EducatorEvidenceDrawerExample[];
}

export interface EducatorAnalyticsDashboard {
  headline_cards: {
    most_widespread: EducatorHeadlineCard;
    most_harmful: EducatorHeadlineCard;
    most_improved_on_repeat_attempts: EducatorHeadlineCard;
  };
  priority_matrix: EducatorPriorityMatrixPoint[];
  heatmap: {
    scenarios: string[];
    themes: { theme: EducatorTeachingTheme; label: string }[];
    cells: EducatorHeatmapCell[];
  };
  conversation_stage_breakdown: EducatorStageBreakdownItem[];
  evidence_drawers: EducatorEvidenceDrawer[];
  action_panel: {
    what_to_emphasise_in_the_next_tutorial: string[];
  };
}

export interface EducatorAnalyticsResponse {
  generated_at: string;
  available_filters: EducatorAnalyticsAvailableFilters;
  report: EducatorAnalyticsReport;
  dashboard: EducatorAnalyticsDashboard;
}
