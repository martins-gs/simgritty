import type { ScenarioTraits, BiasCategory } from "@/types/scenario";

export interface TraitDialDefinition {
  key: keyof Omit<ScenarioTraits, "bias_category">;
  label: string;
  description: string;
  category: "emotional" | "behavioural" | "cognitive";
  min: number;
  max: number;
  lowLabel: string;
  highLabel: string;
}

export const TRAIT_DIALS: TraitDialDefinition[] = [
  // Emotional
  {
    key: "hostility",
    label: "Hostility",
    description: "Degree of hostility directed at the clinician",
    category: "emotional",
    min: 0, max: 10,
    lowLabel: "Friendly", highLabel: "Hostile",
  },
  {
    key: "frustration",
    label: "Frustration",
    description: "Level of frustration and exasperation",
    category: "emotional",
    min: 0, max: 10,
    lowLabel: "Patient", highLabel: "Extremely frustrated",
  },
  {
    key: "impatience",
    label: "Impatience",
    description: "Tolerance for delays and explanations",
    category: "emotional",
    min: 0, max: 10,
    lowLabel: "Patient", highLabel: "Demands immediacy",
  },
  {
    key: "trust",
    label: "Trust in Clinician",
    description: "Baseline trust in the healthcare professional",
    category: "emotional",
    min: 0, max: 10,
    lowLabel: "Deep distrust", highLabel: "Trusting",
  },
  // Behavioural
  {
    key: "willingness_to_listen",
    label: "Willingness to Listen",
    description: "Openness to hearing what the clinician says",
    category: "behavioural",
    min: 0, max: 10,
    lowLabel: "Closed off", highLabel: "Very receptive",
  },
  {
    key: "sarcasm",
    label: "Sarcasm",
    description: "Tendency to use sarcastic or mocking language",
    category: "behavioural",
    min: 0, max: 10,
    lowLabel: "Sincere", highLabel: "Heavily sarcastic",
  },
  {
    key: "volatility",
    label: "Volatility",
    description: "How quickly mood can swing between states",
    category: "behavioural",
    min: 0, max: 10,
    lowLabel: "Stable", highLabel: "Highly volatile",
  },
  {
    key: "boundary_respect",
    label: "Boundary Respect",
    description: "Respect for professional boundaries and personal space",
    category: "behavioural",
    min: 0, max: 10,
    lowLabel: "Boundary-violating", highLabel: "Respectful",
  },
  {
    key: "interruption_likelihood",
    label: "Interruption Likelihood",
    description: "Tendency to interrupt the clinician mid-sentence",
    category: "behavioural",
    min: 0, max: 10,
    lowLabel: "Waits turn", highLabel: "Constantly interrupts",
  },
  // Cognitive
  {
    key: "coherence",
    label: "Coherence",
    description: "Logical clarity and consistency of speech",
    category: "cognitive",
    min: 0, max: 10,
    lowLabel: "Incoherent", highLabel: "Very clear",
  },
  {
    key: "repetition",
    label: "Repetition",
    description: "Tendency to repeat the same points or grievances",
    category: "cognitive",
    min: 0, max: 10,
    lowLabel: "Varied", highLabel: "Fixated/repetitive",
  },
  {
    key: "entitlement",
    label: "Entitlement",
    description: "Sense of being owed special treatment",
    category: "cognitive",
    min: 0, max: 10,
    lowLabel: "Humble", highLabel: "Highly entitled",
  },
  {
    key: "bias_intensity",
    label: "Bias / Prejudice Intensity",
    description: "Strength of discriminatory or prejudiced behaviour",
    category: "cognitive",
    min: 0, max: 10,
    lowLabel: "None", highLabel: "Intense",
  },
  {
    key: "escalation_tendency",
    label: "Escalation Tendency",
    description: "Natural tendency to escalate vs. de-escalate",
    category: "cognitive",
    min: 0, max: 10,
    lowLabel: "Self-moderating", highLabel: "Rapidly escalates",
  },
];

export const BIAS_CATEGORIES: { value: BiasCategory; label: string }[] = [
  { value: "none", label: "None" },
  { value: "gender", label: "Gender bias" },
  { value: "racial", label: "Racial bias" },
  { value: "age", label: "Age bias" },
  { value: "accent", label: "Accent bias" },
  { value: "class_status", label: "Class/status bias" },
  { value: "role_status", label: "Role/status bias" },
  { value: "mixed", label: "Mixed" },
];

export const TRAIT_CATEGORIES = [
  { key: "emotional" as const, label: "Emotional Baseline" },
  { key: "behavioural" as const, label: "Behavioural Style" },
  { key: "cognitive" as const, label: "Cognitive / Contextual" },
];
