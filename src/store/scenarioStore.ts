import { create } from "zustand";
import type {
  ScenarioTraits,
  ScenarioVoiceConfig,
  EscalationRules,
  Difficulty,
  ScoringWeights,
  DEFAULT_TRAITS,
  DEFAULT_VOICE_CONFIG,
  DEFAULT_ESCALATION_RULES,
} from "@/types/scenario";
import {
  DEFAULT_TRAITS as TRAITS_DEFAULT,
  DEFAULT_VOICE_CONFIG as VOICE_DEFAULT,
  DEFAULT_ESCALATION_RULES as RULES_DEFAULT,
} from "@/types/scenario";

export interface MilestoneFormItem {
  id?: string;
  description: string;
  classifier_hint: string;
}

interface ScenarioFormState {
  // Basics
  title: string;
  setting: string;
  trainee_role: string;
  ai_role: string;
  backstory: string;
  emotional_driver: string;
  difficulty: Difficulty;
  archetype_tag: string | null;
  learning_objectives: string;
  pre_simulation_briefing_text: string;
  content_warning_text: string;
  educator_facilitation_recommended: boolean;

  // Scoring configuration
  support_threshold: number | null;
  critical_threshold: number | null;
  scoring_weights: ScoringWeights | null;
  milestones: MilestoneFormItem[];

  // Sub-objects
  traits: ScenarioTraits;
  voice_config: ScenarioVoiceConfig;
  escalation_rules: EscalationRules;

  // Actions
  setField: <K extends keyof ScenarioFormState>(key: K, value: ScenarioFormState[K]) => void;
  setTraits: (traits: Partial<ScenarioTraits>) => void;
  setVoiceConfig: (config: Partial<ScenarioVoiceConfig>) => void;
  setEscalationRules: (rules: Partial<EscalationRules>) => void;
  setScoringWeights: (weights: Partial<ScoringWeights>) => void;
  addMilestone: () => void;
  updateMilestone: (index: number, data: Partial<MilestoneFormItem>) => void;
  removeMilestone: (index: number) => void;
  applyArchetype: (archetype: {
    traits: ScenarioTraits;
    voice_config: ScenarioVoiceConfig;
    escalation_rules: EscalationRules;
    defaults?: Partial<ScenarioFormState>;
  }) => void;
  reset: () => void;
  loadScenario: (data: Partial<ScenarioFormState>) => void;
}

const initialState = {
  title: "",
  setting: "",
  trainee_role: "",
  ai_role: "",
  backstory: "",
  emotional_driver: "",
  difficulty: "moderate" as Difficulty,
  archetype_tag: null,
  learning_objectives: "",
  pre_simulation_briefing_text: "",
  content_warning_text: "",
  educator_facilitation_recommended: false,
  support_threshold: null as number | null,
  critical_threshold: null as number | null,
  scoring_weights: null as ScoringWeights | null,
  milestones: [] as MilestoneFormItem[],
  traits: { ...TRAITS_DEFAULT },
  voice_config: { ...VOICE_DEFAULT },
  escalation_rules: { ...RULES_DEFAULT },
};

export const useScenarioStore = create<ScenarioFormState>((set) => ({
  ...initialState,

  setField: (key, value) => set({ [key]: value }),

  setTraits: (partial) =>
    set((state) => ({ traits: { ...state.traits, ...partial } })),

  setVoiceConfig: (partial) =>
    set((state) => ({ voice_config: { ...state.voice_config, ...partial } })),

  setEscalationRules: (partial) =>
    set((state) => ({
      escalation_rules: { ...state.escalation_rules, ...partial },
    })),

  setScoringWeights: (partial) =>
    set((state) => ({
      scoring_weights: {
        composure: 0.25,
        de_escalation: 0.25,
        clinical_task: 0.25,
        support_seeking: 0.25,
        ...state.scoring_weights,
        ...partial,
      },
    })),

  addMilestone: () =>
    set((state) => {
      if (state.milestones.length >= 10) return state;
      return { milestones: [...state.milestones, { description: "", classifier_hint: "" }] };
    }),

  updateMilestone: (index, data) =>
    set((state) => {
      const updated = [...state.milestones];
      updated[index] = { ...updated[index], ...data };
      return { milestones: updated };
    }),

  removeMilestone: (index) =>
    set((state) => ({
      milestones: state.milestones.filter((_, i) => i !== index),
    })),

  applyArchetype: (archetype) =>
    set({
      traits: { ...archetype.traits },
      voice_config: { ...archetype.voice_config },
      escalation_rules: { ...archetype.escalation_rules },
      ...archetype.defaults,
    }),

  reset: () => set(initialState),

  loadScenario: (data) => set(data),
}));
