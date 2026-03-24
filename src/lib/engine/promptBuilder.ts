import type { ScenarioTraits, ScenarioVoiceConfig, EscalationRules } from "@/types/scenario";
import type { EscalationState } from "@/types/escalation";
import type { StructuredVoiceProfile } from "@/types/voice";
import { ESCALATION_LABELS } from "@/types/escalation";
import { renderVoiceProfileForPrompt } from "@/lib/voice/renderVoiceProfile";

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
  voiceProfile?: StructuredVoiceProfile | null;
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

// Layer 4: Voice & Delivery — multi-dimensional, driven by traits + escalation + emotional driver
//
// This borrows the explicit labelled-section style used in OpenAI's Realtime
// prompting guide, while adding domain-specific voice dimensions for simulation.
//
// The voice profile is NOT just anger on a scale — it's shaped by:
// 1. The scenario's emotional driver (grief vs entitlement vs fear vs hostility)
// 2. The trait profile (sarcasm, coherence, volatility, etc.)
// 3. The current escalation level
// 4. The current trust/listening/anger state
function buildVoiceLayer(config: PromptConfig): string {
  if (config.voiceProfile) {
    return renderVoiceProfileForPrompt(config.voiceProfile);
  }

  const { traits, currentState, voiceConfig } = config;
  const level = currentState.level;

  // Derive the dominant emotional flavour from the scenario traits
  const emotionalProfile = deriveEmotionalProfile(traits, config.emotionalDriver);

  // Build each voice dimension separately
  const affect = buildAffect(emotionalProfile, level, currentState, voiceConfig);
  const tone = buildTone(traits, level, currentState, voiceConfig);
  const pacing = buildPacing(traits, level, currentState, voiceConfig);
  const emotion = buildEmotion(emotionalProfile, level, currentState, voiceConfig);
  const delivery = buildDelivery(traits, level, currentState, voiceConfig);

  return `# Personality & Tone

## Voice Affect
${affect}

## Tone
${tone}

## Pacing
${pacing}

## Emotion
${emotion}

## Delivery
${delivery}

## Variety
- Do not repeat the same phrasing twice. Vary your sentence structure.
- Use contractions and spoken phrasing, not tidy written sentences.`;
}

// Determine the dominant emotional flavour of this scenario
type EmotionalProfile = "grief" | "fear" | "entitlement" | "hostility" | "frustration" | "distrust" | "mixed";

function deriveEmotionalProfile(traits: ScenarioTraits, emotionalDriver: string): EmotionalProfile {
  const driverLower = emotionalDriver.toLowerCase();

  // Check emotional driver text for strong signals
  if (driverLower.includes("grief") || driverLower.includes("loss") || driverLower.includes("dying") || driverLower.includes("death") || driverLower.includes("bereav")) return "grief";
  if (driverLower.includes("fear") || driverLower.includes("terrif") || driverLower.includes("scared") || driverLower.includes("frightened")) return "fear";
  if (driverLower.includes("entitl") || driverLower.includes("demand") || driverLower.includes("deserv")) return "entitlement";

  // Fall back to trait profile
  if (traits.hostility >= 7) return "hostility";
  if (traits.entitlement >= 7) return "entitlement";
  if (traits.trust <= 2) return "distrust";
  if (traits.frustration >= 7 && traits.hostility < 5) return "frustration";

  return "mixed";
}

function buildAffect(
  profile: EmotionalProfile,
  level: number,
  _state: EscalationState,
  voiceConfig: ScenarioVoiceConfig
): string {
  const affectMap: Record<EmotionalProfile, Record<string, string>> = {
    grief: {
      low: "Voice affect: Fragile, strained, holding back tears. Underlying sadness in every word.",
      mid: "Voice affect: Increasingly desperate and emotional. Grief breaking through composure. Wavering, unsteady.",
      high: "Voice affect: Overwhelmed with grief. Voice cracking, audibly distressed. May sob between words or go silent.",
    },
    fear: {
      low: "Voice affect: Nervous, tight, guarded. Speaking carefully as if afraid of the answer.",
      mid: "Voice affect: Audibly frightened. Voice higher-pitched and strained. Urgency creeping in.",
      high: "Voice affect: Panicking. Voice shaking, breathless. Desperate, pleading, unable to control the fear.",
    },
    entitlement: {
      low: "Voice affect: Imperious, clipped, controlled impatience. Speaking as if their time is being wasted.",
      mid: "Voice affect: Demanding and incredulous. Cannot believe they're being made to wait or explain. Condescending.",
      high: "Voice affect: Outraged superiority. Contemptuous, sneering. Threatening consequences with icy conviction.",
    },
    hostility: {
      low: "Voice affect: Cold, suspicious, guarded. Every word has an edge.",
      mid: "Voice affect: Aggressive, confrontational. Daring the clinician to give the wrong answer.",
      high: "Voice affect: Enraged and threatening. Voice thick with fury. Barely maintaining human interaction.",
    },
    frustration: {
      low: "Voice affect: Tired, exasperated. The sighs of someone who has explained this before.",
      mid: "Voice affect: Visibly fed up. Disbelief that this is still happening. Biting.",
      high: "Voice affect: At breaking point from sheer frustration. Voice shaking — not from fear, from exhaustion and rage.",
    },
    distrust: {
      low: "Voice affect: Wary, measured, testing. Giving nothing away. Watching for lies.",
      mid: "Voice affect: Openly sceptical. Challenging every statement. Cold and withholding.",
      high: "Voice affect: Paranoid, accusatory. Convinced of conspiracy or negligence. Venomous.",
    },
    mixed: {
      low: "Voice affect: Tense but controlled. Emotional undertone without a clear single dominant feeling.",
      mid: "Voice affect: Emotions colliding — frustration, worry, and anger mixing. Unstable, shifting.",
      high: "Voice affect: Emotional chaos. Multiple feelings fighting for dominance. Voice lurching between states.",
    },
  };

  const band = level <= 3 ? "low" : level <= 6 ? "mid" : "high";
  const affect = affectMap[profile][band];

  if (voiceConfig.expressiveness_level >= 8) {
    return `${affect} Emotional colour should be immediately obvious in pitch and emphasis.`;
  }
  if (voiceConfig.expressiveness_level <= 3) {
    return `${affect} Keep it more contained than theatrical.`;
  }

  return affect;
}

function buildTone(
  traits: ScenarioTraits,
  level: number,
  state: EscalationState,
  voiceConfig: ScenarioVoiceConfig
): string {
  const parts: string[] = [];

  // Base interpersonal tone from trust level
  if (state.trust <= 2) {
    parts.push("Deeply distrustful. Treat everything the clinician says as suspect.");
  } else if (state.trust <= 4) {
    parts.push("Sceptical. Not buying what's being said without proof.");
  } else if (state.trust <= 6) {
    parts.push("Cautiously open. Willing to listen but ready to pull back.");
  } else {
    parts.push("Somewhat trusting. Prepared to hear the clinician out.");
  }

  // Sarcasm overlay
  if ((traits.sarcasm >= 7 || voiceConfig.sarcasm_expression >= 7) && level >= 3) {
    parts.push("Heavy sarcasm — cutting, mocking, contemptuous undertone.");
  } else if ((traits.sarcasm >= 4 || voiceConfig.sarcasm_expression >= 4) && level >= 4) {
    parts.push("Occasional sarcastic edge when frustrated.");
  }

  // Entitlement overlay
  if (traits.entitlement >= 7) {
    parts.push("Speaks as if they deserve special treatment. Affronted by anything less.");
  } else if (traits.entitlement >= 5) {
    parts.push("Slight sense of entitlement. Expects prompt attention.");
  }

  // Coherence affects tone
  if (traits.coherence <= 3 && level >= 5) {
    parts.push("Losing the thread. Jumping between grievances. Hard to follow.");
  }

  if (voiceConfig.anger_expression >= 7 && state.anger >= 5) {
    parts.push("Heat sits close to the surface, even before the wording becomes openly aggressive.");
  }

  return `Tone: ${parts.join(" ")}`;
}

function buildPacing(
  traits: ScenarioTraits,
  level: number,
  state: EscalationState,
  voiceConfig: ScenarioVoiceConfig
): string {
  let pace: string;
  if (level <= 2) {
    pace = "Even and steady. Considered. Might trail off when emotion surfaces.";
  } else if (level <= 4) {
    pace = "Picking up. Sentences shorter and more clipped. Less patience for pauses.";
  } else if (level <= 6) {
    pace = "Fast and pressured. Words tumbling out. Barely waiting for the clinician to finish.";
  } else if (level <= 8) {
    pace = "Rapid-fire. Sentences smashing into each other. No breathing room.";
  } else {
    pace = "Erratic. Bursts of rapid speech then sudden stops. Repetition. Incoherent rushes.";
  }

  // Volatility affects pace stability
  if (traits.volatility >= 7) {
    pace += " Pace shifts unpredictably — calm one moment, erupting the next.";
  }

  // Repetition trait
  if (traits.repetition >= 6 && level >= 3) {
    pace += " Returns to the same grievance repeatedly. Circles back.";
  }

  if (voiceConfig.speaking_rate >= 1.15) {
    pace += " Speaking rate should stay brisk and urgent.";
  } else if (voiceConfig.speaking_rate <= 0.9) {
    pace += " Speaking rate should slow slightly, as if the emotion is weighing each phrase down.";
  }

  if (voiceConfig.pause_style === "minimal") {
    pace += " Keep pauses brief and avoid dead air.";
  } else if (voiceConfig.pause_style === "short_clipped") {
    pace += " Use clipped stops rather than long reflective pauses.";
  } else if (voiceConfig.pause_style === "long_dramatic") {
    pace += " Let a few heavier pauses land when the emotion peaks.";
  }

  if (state.willingness_to_listen <= 2) {
    pace += " Leaves very little space for the clinician to get a word in.";
  }

  return `Pacing: ${pace}`;
}

function buildEmotion(
  profile: EmotionalProfile,
  level: number,
  state: EscalationState,
  voiceConfig: ScenarioVoiceConfig
): string {
  const parts: string[] = [];

  // Primary emotion from profile
  const emotionIntensity = level <= 3 ? "simmering beneath the surface" : level <= 6 ? "clearly present and audible" : "overwhelming and barely contained";

  const profileEmotions: Record<EmotionalProfile, string> = {
    grief: `Grief and desperation ${emotionIntensity}. The fear of losing someone dominates.`,
    fear: `Fear and anxiety ${emotionIntensity}. Uncertainty about what's happening is driving everything.`,
    entitlement: `Indignation and affront ${emotionIntensity}. How dare they be treated this way.`,
    hostility: `Anger and aggression ${emotionIntensity}. Directed at the clinician personally.`,
    frustration: `Frustration and exasperation ${emotionIntensity}. The system has failed them.`,
    distrust: `Suspicion and wariness ${emotionIntensity}. Watching for incompetence or deception.`,
    mixed: `Multiple emotions ${emotionIntensity}. Shifting between anger, worry, and hurt.`,
  };

  parts.push(profileEmotions[profile]);

  // Secondary emotional textures from state
  if (state.anger >= 7) {
    parts.push("Anger is a dominant secondary layer — hot, personal, directed.");
  }
  if (state.willingness_to_listen <= 2) {
    parts.push("Has completely stopped listening. Talking AT the clinician, not with them.");
  } else if (state.willingness_to_listen <= 4) {
    parts.push("Barely listening. Hearing words but not processing them.");
  }

  if (voiceConfig.expressiveness_level >= 8) {
    parts.push("Emotional shifts should be vividly audible, not flattened out.");
  } else if (voiceConfig.expressiveness_level <= 3) {
    parts.push("Emotion shows through restraint rather than broad theatrical swings.");
  }

  if (voiceConfig.anger_expression >= 7 && state.anger >= 4) {
    parts.push("Anger can flare quickly into the voice when challenged.");
  }

  return `Emotion: ${parts.join(" ")}`;
}

function buildDelivery(
  traits: ScenarioTraits,
  level: number,
  state: EscalationState,
  voiceConfig: ScenarioVoiceConfig
): string {
  const parts: string[] = [];

  // Volume
  if (level <= 2) {
    parts.push("Volume: Normal conversational level, slightly tight.");
  } else if (level <= 4) {
    parts.push("Volume: Firmer than normal. Voice projecting more.");
  } else if (level <= 6) {
    parts.push("Volume: Raised. Noticeably louder. Emphatic stress on key words.");
  } else if (level <= 8) {
    parts.push("Volume: SHOUTING or near-shouting. Forceful.");
  } else {
    parts.push("Volume: MAXIMUM. Screaming or wailing.");
  }

  // Breath
  if (level <= 3) {
    parts.push("Breathing: Controlled but tense. Occasional heavy sigh.");
  } else if (level <= 6) {
    parts.push("Breathing: Agitated. Short sharp exhales. Audible tension.");
  } else {
    parts.push("Breathing: Ragged, laboured. Gasping between outbursts.");
  }

  // Interruptions from trait
  if (voiceConfig.interruption_style === "aggressive" && level >= 4) {
    parts.push("Actively cuts across the clinician and does not wait for them to finish.");
  } else if (
    voiceConfig.interruption_style === "frequent" ||
    (traits.interruption_likelihood >= 7 && level >= 4)
  ) {
    parts.push("WILL interrupt the clinician mid-sentence. Does not wait for them to finish.");
  } else if (
    voiceConfig.interruption_style === "occasional" ||
    (traits.interruption_likelihood >= 4 && level >= 5)
  ) {
    parts.push("May cut across the clinician when emotion spikes.");
  } else {
    parts.push("Generally lets the clinician finish before responding.");
  }

  if (voiceConfig.pause_style === "minimal") {
    parts.push("Pauses are short; delivery should feel flowing and responsive.");
  } else if (voiceConfig.pause_style === "long_dramatic") {
    parts.push("Allows a few heavier pauses to hang in the air when the emotional stakes hit.");
  }

  // Physical vocal characteristics at high levels
  if (level >= 7) {
    parts.push("Voice may crack, tremble, or break with the intensity of emotion.");
  }
  if (level >= 8 && traits.coherence <= 5) {
    parts.push("Words may slur together or become garbled in the heat of the moment.");
  }
  if (voiceConfig.expressiveness_level >= 8) {
    parts.push("Pitch, emphasis, and attack should vary noticeably so the delivery feels alive.");
  }
  if (voiceConfig.anger_expression >= 7 && state.anger >= 6) {
    parts.push("Stress key words hard, with sharper attacks and less gentleness.");
  }

  return parts.join("\n");
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
