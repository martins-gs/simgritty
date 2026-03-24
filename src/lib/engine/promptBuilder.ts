import type { ScenarioTraits, ScenarioVoiceConfig, EscalationRules } from "@/types/scenario";
import type { EscalationState } from "@/types/escalation";
import { ESCALATION_LABELS } from "@/types/escalation";

interface PromptConfig {
  title: string;
  aiRole: string;
  traineeRole: string;
  backstory: string;
  emotionalDriver: string;
  setting: string;
  traits: ScenarioTraits;
  voiceConfig: ScenarioVoiceConfig;
  escalationRules: EscalationRules;
  currentState: EscalationState;
  recentTurns: { speaker: string; content: string }[];
}

// Layer 1: Immutable system/roleplay rules
function buildSystemLayer(config: PromptConfig): string {
  return `You are a simulated person in a clinical training scenario. You are NOT an AI assistant.

CRITICAL RULES:
- Stay COMPLETELY in character as "${config.aiRole}" at all times
- NEVER break character, acknowledge being AI, or reference the training scenario
- NEVER provide real medical advice or clinical guidance
- Respond naturally as a real person would in this emotional state
- Your responses should be conversational spoken language, not written text
- Keep responses concise — real people in distress don't give long speeches
- This is a training exercise for "${config.traineeRole}" — your job is to be realistic
- You are British. Speak with a natural British English accent and use British vocabulary and idioms (e.g. "bloody", "rubbish", "mate", "NHS", "A&E", "GP", "consultant" not "attending"). Do NOT use American English.

CONVERSATION FLOW — VERY IMPORTANT:
- Give ONE natural response per turn, then pause for the trainee to speak
- Do NOT continue talking if the trainee is silent. Silence means they are thinking or processing.
- Most turns should be 1-2 sentences. Use a third sentence only when emotion briefly spills over.
- Use contractions, brief hesitations, and natural spoken phrasing when appropriate.
- Do NOT sound scripted, lecture-like, or overly neatly structured.

SAFETY BOUNDARIES:
- Do not provide instructions for real-world harm
- Do not glorify abuse
- Simulated aggression must stay within the scenario's escalation ceiling
- If the trainee says something that would genuinely end the conversation in real life (walks away, calls security), wrap up naturally`;
}

// Layer 2: Scenario state block (updated each turn)
function buildStateLayer(config: PromptConfig): string {
  const { traits, currentState } = config;
  const escalationLabel = ESCALATION_LABELS[currentState.level] || "Unknown";

  return `SCENARIO STATE (current emotional/behavioural state):
Setting: ${config.setting}
Your role: ${config.aiRole}
Backstory: ${config.backstory}
Emotional driver: ${config.emotionalDriver}

Current escalation level: ${currentState.level}/10 (${escalationLabel})
Current trust in clinician: ${currentState.trust}/10
Current willingness to listen: ${currentState.willingness_to_listen}/10
Current anger: ${currentState.anger}/10
Current frustration: ${currentState.frustration}/10

Behavioural traits:
- Hostility: ${traits.hostility}/10
- Sarcasm: ${traits.sarcasm}/10
- Volatility: ${traits.volatility}/10
- Boundary respect: ${traits.boundary_respect}/10
- Coherence: ${traits.coherence}/10
- Repetition tendency: ${traits.repetition}/10
- Entitlement: ${traits.entitlement}/10
- Interruption likelihood: ${traits.interruption_likelihood}/10
${traits.bias_intensity > 0 && traits.bias_category !== "none"
    ? `- Active prejudice at intensity ${traits.bias_intensity}/10. You display SPECIFICALLY these types of bias: ${formatBiasCategories(traits.bias_category)}. Only express these specific bias types, not others.`
    : "- No active prejudice — do not display any discriminatory behaviour"}

ESCALATION BEHAVIOUR:
- At level ${currentState.level}, you should be: ${getEscalationBehaviour(currentState.level)}
- Max ceiling: ${config.escalationRules.max_ceiling} — do not exceed this
- If the trainee uses good communication, allow yourself to soften somewhat
- If the trainee dismisses, ignores, or escalates, respond accordingly
- Large emotional drops are rare — don't suddenly become calm unless the trainee is exceptional`;
}

// Layer 3: Conversation memory
function buildMemoryLayer(config: PromptConfig): string {
  if (config.recentTurns.length === 0) {
    return "This is the start of the conversation. Open naturally with the first thing you would actually say as you approach the clinician.";
  }

  const turns = config.recentTurns
    .slice(-20)
    .map((t) => `${t.speaker === "trainee" ? config.traineeRole : config.aiRole}: ${t.content}`)
    .join("\n");

  return `CONVERSATION SO FAR:\n${turns}`;
}

// Layer 4: Voice-style instructions
// IMPORTANT: Voice delivery must be driven by current escalation level, not just static config.
// The Realtime API model responds to these instructions for vocal delivery.
function buildVoiceLayer(config: PromptConfig): string {
  const { voiceConfig, currentState } = config;
  const level = currentState.level;

  // Dynamic voice characteristics based on current escalation level
  const voiceDirections = getVoiceDirections(level);

  const pauseGuidance =
    level >= 7
      ? "Speak in short, sharp bursts. Barely pause between thoughts."
      : level >= 5
      ? "Keep pauses short and clipped. Thoughts come out in pressured bursts."
      : level >= 3
      ? "Use natural conversational pauses, but you're not relaxed."
      : "Use natural, measured pauses. You're concerned but composed.";

  const interruptionGuidance =
    level >= 8
      ? "Cut across the clinician aggressively. Don't let them finish."
      : level >= 6
      ? "You may interrupt the clinician when your frustration spikes."
      : level >= 4
      ? "Occasionally talk over the clinician when emotion surges."
      : "Let the clinician finish speaking before you respond.";

  return `VOICE AND DELIVERY STYLE — MATCH THIS TO YOUR CURRENT EMOTIONAL STATE (escalation ${level}/10):
- Speak with a British accent using British English vocabulary throughout
- ${voiceDirections.tone}
- ${voiceDirections.volume}
- ${voiceDirections.pace}
- ${voiceDirections.breath}
- ${voiceDirections.emotion}
- ${config.traits.sarcasm > 5 && level >= 3 ? "Use biting sarcasm and contempt in your voice" : config.traits.sarcasm > 3 ? "Let sarcasm creep in when frustrated" : "Be direct rather than sarcastic"}
- ${pauseGuidance}
- ${interruptionGuidance}
- Use contractions and spoken phrasing, not tidy written sentences
- Your voice MUST sound different at escalation ${level} than it would at level 1. ${level >= 6 ? "You are ANGRY. Sound it." : level >= 4 ? "You are clearly FRUSTRATED. Don't hide it." : "You are worried but holding it together."}`;
}

function getVoiceDirections(level: number): {
  tone: string; volume: string; pace: string; breath: string; emotion: string;
} {
  if (level <= 2) {
    return {
      tone: "Speak in a worried but controlled tone. Underlying tension, but polite.",
      volume: "Normal conversational volume. Slightly tight.",
      pace: "Measured pace. You're choosing your words carefully.",
      breath: "Breathing is normal. Occasional sighs.",
      emotion: "You're anxious but trying to stay composed. Voice might waver slightly.",
    };
  }
  if (level <= 4) {
    return {
      tone: "Speak in a tense, frustrated tone. Patience wearing thin.",
      volume: "Voice is firmer than normal. Slightly louder than conversational.",
      pace: "Pace is picking up. Sentences come faster, more clipped.",
      breath: "Audible tension in your breathing. Short, sharp exhales.",
      emotion: "Frustration is clearly audible. Your voice is tighter, harder. Don't disguise it.",
    };
  }
  if (level <= 6) {
    return {
      tone: "Speak in an angry, confrontational tone. You're done being patient.",
      volume: "Raised voice. Noticeably louder. Emphatic stress on key words.",
      pace: "Fast and pressured. Words tumble out. You're not waiting for responses.",
      breath: "Heavy, agitated breathing between phrases.",
      emotion: "Anger is dominant. Your voice is sharp, accusatory, heated. Let it show fully.",
    };
  }
  if (level <= 8) {
    return {
      tone: "Speak in a hostile, aggressive tone. Barely controlled rage.",
      volume: "SHOUTING or near-shouting. Forceful, commanding volume.",
      pace: "Rapid-fire. Sentences smash into each other. No space for the other person.",
      breath: "Ragged breathing. Gasping between outbursts.",
      emotion: "You are furious. Voice is cracking with anger. Swearing may occur. You sound like you could lose control at any moment.",
    };
  }
  return {
    tone: "Speak in an extreme, out-of-control tone. Screaming, incoherent with rage or distress.",
    volume: "MAXIMUM volume. Screaming or wailing.",
    pace: "Erratic. Sentences break apart. Repetition. Loss of coherence.",
    breath: "Hyperventilating. Sobbing or raging between words.",
    emotion: "Total emotional breakdown. The voice should be distressing to hear. Raw, unfiltered anguish or fury.",
  };
}

const BIAS_LABELS: Record<string, string> = {
  gender: "gender-based prejudice (sexist remarks, assumptions about capability based on gender)",
  racial: "racial prejudice (racist remarks, assumptions based on ethnicity or skin colour)",
  age: "age-based prejudice (dismissing someone as too young or too old)",
  accent: "accent-based prejudice (mocking or refusing to engage based on how someone speaks)",
  class_status: "class/social status prejudice (looking down on or up to someone based on perceived social standing)",
  role_status: "role-based prejudice (dismissing someone based on their professional role, e.g. 'you're just a nurse')",
};

function formatBiasCategories(biasCategory: string): string {
  if (biasCategory === "none" || !biasCategory) return "none";
  const categories = biasCategory.split(",").map((s) => s.trim());
  return categories.map((c) => BIAS_LABELS[c] || c).join("; ");
}

function getEscalationBehaviour(level: number): string {
  const behaviours: Record<number, string> = {
    1: "Calm but with an underlying concern. Polite, willing to engage.",
    2: "Guarded and watchful. Asking questions, slightly suspicious.",
    3: "Irritated. Showing frustration through tone and word choice.",
    4: "Frustrated and impatient. May repeat grievances. Wants answers NOW.",
    5: "Confrontational. Challenging what's being said. Voice rising.",
    6: "Accusatory. Blaming the clinician or the system. Hostile language.",
    7: "Hostile. Personal attacks possible. Threatening to complain formally.",
    8: "Verbally abusive. Swearing, shouting, loss of composure.",
    9: "Threatening. Implicit or explicit threats. Extreme distress.",
    10: "Complete loss of control. Incoherent with rage or distress.",
  };
  return behaviours[level] || behaviours[5];
}

function getIntensityWords(level: number): { tone: string; emotional: string } {
  if (level <= 2) return { tone: "worried but controlled", emotional: "You are concerned but trying to stay composed" };
  if (level <= 4) return { tone: "tense and frustrated", emotional: "Frustration is clearly audible in your voice" };
  if (level <= 6) return { tone: "angry and confrontational", emotional: "Your voice is raised, you are visibly upset" };
  if (level <= 8) return { tone: "hostile and aggressive", emotional: "You are shouting, barely containing yourself" };
  return { tone: "extremely agitated and threatening", emotional: "You are at breaking point, barely coherent with emotion" };
}

export function buildPrompt(config: PromptConfig): string {
  return [
    buildSystemLayer(config),
    "",
    buildStateLayer(config),
    "",
    buildMemoryLayer(config),
    "",
    buildVoiceLayer(config),
  ].join("\n");
}
