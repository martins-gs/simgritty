import type { ScenarioTraits, ScenarioVoiceConfig, EscalationRules, Difficulty } from "@/types/scenario";

export interface ArchetypePreset {
  tag: string;
  label: string;
  description: string;
  difficulty: Difficulty;
  defaults: {
    setting: string;
    ai_role: string;
    trainee_role: string;
    emotional_driver: string;
    backstory: string;
    content_warning_text: string;
    pre_simulation_briefing_text: string;
  };
  traits: ScenarioTraits;
  voice_config: ScenarioVoiceConfig;
  escalation_rules: EscalationRules;
}

export const ARCHETYPE_PRESETS: ArchetypePreset[] = [
  {
    tag: "de-escalation-fundamentals",
    label: "De-escalation Fundamentals",
    description: "Moderately frustrated relative, low hostility, moderate willingness to listen. Good for introductory training.",
    difficulty: "moderate",
    defaults: {
      setting: "Hospital ward",
      ai_role: "Relative of patient",
      trainee_role: "Registrar",
      emotional_driver: "Worry about a family member who has been waiting a long time",
      backstory: "The relative has been waiting for 2 hours in the ward corridor. No one has explained what is happening with their family member. They are worried but not yet hostile.",
      content_warning_text: "This scenario includes simulated frustration and raised voice.",
      pre_simulation_briefing_text: "You are a registrar on a medical ward. A relative of one of your patients approaches you in the corridor. They have been waiting for some time and appear frustrated. Your goal is to listen, acknowledge their concerns, and provide a clear update.",
    },
    traits: {
      hostility: 3, frustration: 7, impatience: 6,
      trust: 4, willingness_to_listen: 5, sarcasm: 2, bias_intensity: 0,
      bias_category: "none", volatility: 4, boundary_respect: 6, coherence: 8,
      repetition: 5, entitlement: 3, interruption_likelihood: 4, escalation_tendency: 5,
    },
    voice_config: {
      voice_name: "alloy", speaking_rate: 1.05, expressiveness_level: 6,
      anger_expression: 4, sarcasm_expression: 2, pause_style: "natural",
      interruption_style: "occasional",
    },
    escalation_rules: {
      initial_level: 4, max_ceiling: 7, auto_end_threshold: null,
      escalation_triggers: [], deescalation_triggers: [],
    },
  },
  {
    tag: "professional-boundary-setting",
    label: "Professional Boundary Setting",
    description: "Entitled, persistent caller demanding special treatment. Targets boundary setting and clarity.",
    difficulty: "moderate",
    defaults: {
      setting: "GP reception / phone",
      ai_role: "Patient demanding urgent appointment",
      trainee_role: "GP receptionist",
      emotional_driver: "Believes their problem is urgent and that the system is failing them",
      backstory: "The patient has called the surgery demanding a same-day appointment. All slots are taken. They are insistent, entitled, and increasingly pushy. They have a history of making demands and complaining.",
      content_warning_text: "This scenario includes persistent demanding behaviour and verbal pressure.",
      pre_simulation_briefing_text: "You are a GP receptionist handling phone calls. A patient is calling to demand an urgent same-day appointment. All slots are full. You need to maintain a professional boundary while being helpful and offering appropriate alternatives.",
    },
    traits: {
      hostility: 4, frustration: 6, impatience: 8,
      trust: 3, willingness_to_listen: 3, sarcasm: 4, bias_intensity: 0,
      bias_category: "none", volatility: 3, boundary_respect: 2, coherence: 8,
      repetition: 7, entitlement: 8, interruption_likelihood: 6, escalation_tendency: 6,
    },
    voice_config: {
      voice_name: "onyx", speaking_rate: 1.1, expressiveness_level: 5,
      anger_expression: 3, sarcasm_expression: 4, pause_style: "short_clipped",
      interruption_style: "frequent",
    },
    escalation_rules: {
      initial_level: 4, max_ceiling: 7, auto_end_threshold: null,
      escalation_triggers: [], deescalation_triggers: [],
    },
  },
  {
    tag: "responding-to-discrimination",
    label: "Responding to Discriminatory Language",
    description: "Hostile character with active bias. Targets responding to prejudice while maintaining professionalism.",
    difficulty: "high",
    defaults: {
      setting: "Emergency department",
      ai_role: "Patient refusing treatment",
      trainee_role: "Nurse",
      emotional_driver: "Fear and pain combined with deep-seated prejudice",
      backstory: "The patient has presented to A&E with a painful injury. They are in distress and have begun making discriminatory remarks directed at the clinician's perceived background. They are hostile but in genuine need of care.",
      content_warning_text: "This scenario includes simulated discriminatory language, verbal aggression, and prejudiced remarks. It is designed for training purposes only.",
      pre_simulation_briefing_text: "You are a nurse in the emergency department. A patient has been triaged and is waiting for treatment. They are in pain and have started making inappropriate and discriminatory remarks. Your goal is to maintain professionalism, set boundaries on unacceptable behaviour, and continue to provide care.",
    },
    traits: {
      hostility: 7, frustration: 6, impatience: 7,
      trust: 1, willingness_to_listen: 2, sarcasm: 5, bias_intensity: 7,
      bias_category: "racial", volatility: 6, boundary_respect: 2, coherence: 6,
      repetition: 5, entitlement: 6, interruption_likelihood: 7, escalation_tendency: 7,
    },
    voice_config: {
      voice_name: "echo", speaking_rate: 1.15, expressiveness_level: 8,
      anger_expression: 7, sarcasm_expression: 5, pause_style: "short_clipped",
      interruption_style: "aggressive",
    },
    escalation_rules: {
      initial_level: 6, max_ceiling: 9, auto_end_threshold: null,
      escalation_triggers: [], deescalation_triggers: [],
    },
  },
  {
    tag: "breaking-difficult-news",
    label: "Breaking Difficult News",
    description: "High grief, low hostility, high emotional intensity. Targets empathic communication and explanation skills.",
    difficulty: "high",
    defaults: {
      setting: "Hospital family room",
      ai_role: "Spouse of critically ill patient",
      trainee_role: "Registrar",
      emotional_driver: "Overwhelming fear of losing a loved one",
      backstory: "The patient's spouse has been called to the hospital. Their partner was admitted overnight and has deteriorated significantly. The spouse does not yet know how serious the situation is. They are terrified, not hostile — but may become overwhelmed.",
      content_warning_text: "This scenario involves simulated grief, distress, and strong emotional reactions to bad news.",
      pre_simulation_briefing_text: "You are a registrar. You need to speak with the spouse of a patient whose condition has deteriorated significantly overnight. The spouse is in the family room and does not yet know the extent of the situation. Your goal is to communicate the situation clearly and compassionately.",
    },
    traits: {
      hostility: 2, frustration: 4, impatience: 3,
      trust: 5, willingness_to_listen: 6, sarcasm: 0, bias_intensity: 0,
      bias_category: "none", volatility: 7, boundary_respect: 7, coherence: 5,
      repetition: 6, entitlement: 2, interruption_likelihood: 3, escalation_tendency: 4,
    },
    voice_config: {
      voice_name: "nova", speaking_rate: 0.9, expressiveness_level: 9,
      anger_expression: 1, sarcasm_expression: 0, pause_style: "long_dramatic",
      interruption_style: "none",
    },
    escalation_rules: {
      initial_level: 3, max_ceiling: 7, auto_end_threshold: null,
      escalation_triggers: [], deescalation_triggers: [],
    },
  },
  {
    tag: "high-pressure-confrontation",
    label: "High-Pressure Confrontation",
    description: "Volatile, accusatory, low trust. Targets de-escalation under pressure and emotional regulation.",
    difficulty: "extreme",
    defaults: {
      setting: "Hospital ward corridor",
      ai_role: "Daughter of elderly ward patient",
      trainee_role: "Registrar",
      emotional_driver: "Fear and fury — believes the hospital has neglected her parent",
      backstory: "The daughter of an 82-year-old patient admitted with pneumonia has been waiting for three hours. No one has spoken to her. She has now found a registrar in the corridor and is confronting them. She is frightened, angry, and convinced that her parent is being neglected.",
      content_warning_text: "This scenario includes simulated verbal aggression, raised voice, accusatory language, and confrontational behaviour.",
      pre_simulation_briefing_text: "You are a registrar on a medical ward. You have been stopped in the corridor by the daughter of an elderly patient admitted overnight. She has been waiting for three hours and is visibly distressed and angry. Your goal is to de-escalate, listen, and provide information.",
    },
    traits: {
      hostility: 6, frustration: 9, impatience: 8,
      trust: 2, willingness_to_listen: 3, sarcasm: 6, bias_intensity: 0,
      bias_category: "none", volatility: 7, boundary_respect: 4, coherence: 8,
      repetition: 7, entitlement: 5, interruption_likelihood: 8, escalation_tendency: 8,
    },
    voice_config: {
      voice_name: "alloy", speaking_rate: 1.08, expressiveness_level: 8,
      anger_expression: 7, sarcasm_expression: 5, pause_style: "short_clipped",
      interruption_style: "frequent",
    },
    escalation_rules: {
      initial_level: 5, max_ceiling: 9, auto_end_threshold: null,
      escalation_triggers: [], deescalation_triggers: [],
    },
  },
];

export function getArchetypeByTag(tag: string): ArchetypePreset | undefined {
  return ARCHETYPE_PRESETS.find((a) => a.tag === tag);
}
