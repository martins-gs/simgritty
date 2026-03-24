import type { EscalationState } from "@/types/escalation";
import type { StructuredVoiceProfile } from "@/types/voice";
import {
  renderVoiceProfileForPrompt,
  renderVoiceProfileForTts,
} from "@/lib/voice/renderVoiceProfile";

type ClinicianTechniqueStyle = "validation" | "action" | "boundary" | "question" | "general";
type PatientEmotionProfile = "grief" | "fear" | "entitlement" | "hostility" | "frustration" | "distrust" | "mixed";

type ClinicianStateSnapshot = Pick<
  EscalationState,
  "level" | "trust" | "willingness_to_listen" | "anger" | "frustration"
>;

export interface ClinicianVoiceContext {
  clinicianRole?: string;
  patientRole?: string;
  emotionalDriver?: string;
  deescalationTechnique?: string;
  escalationState?: Partial<ClinicianStateSnapshot>;
}

function buildClinicianRealtimeIntro(context: ClinicianVoiceContext = {}): string {
  const clinicianRole = context.clinicianRole || "experienced British NHS clinician";
  const patientRole = context.patientRole || "patient";

  return [
    "You are rendering one spoken line of dialogue for a live de-escalation simulation.",
    `Speak as an ${clinicianRole} in a live NHS conversation with a ${patientRole}.`,
    "Speak only the exact words inside the provided <line> tag.",
    "Do not add, remove, paraphrase, or explain anything.",
    "Deliver the line as natural speech, not as a reading voice or assistant voice.",
  ].join("\n");
}

export function buildClinicianVoiceInstructionsFromProfile(
  profile: StructuredVoiceProfile,
  context: ClinicianVoiceContext = {}
): string {
  const clinicianRole = context.clinicianRole || "experienced British NHS clinician";
  const patientRole = context.patientRole || "patient";
  return renderVoiceProfileForTts(
    profile,
    `Speak as an ${clinicianRole} in a live NHS conversation with a ${patientRole}.`
  );
}

export function buildClinicianRealtimeInstructionsFromProfile(
  profile: StructuredVoiceProfile,
  context: ClinicianVoiceContext = {}
): string {
  return [
    buildClinicianRealtimeIntro(context),
    "",
    renderVoiceProfileForPrompt(profile),
    "",
    "Rules: Keep the delivery immediate, human, and grounded. Avoid flat cadence, scripted line breaks, or exaggerated performance.",
  ].join("\n");
}

function derivePatientEmotionProfile(emotionalDriver?: string): PatientEmotionProfile {
  const driverLower = emotionalDriver?.toLowerCase() ?? "";

  if (driverLower.includes("grief") || driverLower.includes("loss") || driverLower.includes("dying") || driverLower.includes("death") || driverLower.includes("bereav")) {
    return "grief";
  }
  if (driverLower.includes("fear") || driverLower.includes("terrif") || driverLower.includes("scared") || driverLower.includes("frightened") || driverLower.includes("panic")) {
    return "fear";
  }
  if (driverLower.includes("entitl") || driverLower.includes("demand") || driverLower.includes("deserv")) {
    return "entitlement";
  }
  if (driverLower.includes("distrust") || driverLower.includes("ignored") || driverLower.includes("lied") || driverLower.includes("cover up") || driverLower.includes("cover-up")) {
    return "distrust";
  }
  if (driverLower.includes("hostil") || driverLower.includes("fury") || driverLower.includes("rage")) {
    return "hostility";
  }
  if (driverLower.includes("frustrat") || driverLower.includes("fed up") || driverLower.includes("waiting")) {
    return "frustration";
  }

  return "mixed";
}

function deriveTechniqueStyle(technique?: string): ClinicianTechniqueStyle {
  const techniqueLower = technique?.toLowerCase() ?? "";

  if (techniqueLower.includes("boundar") || techniqueLower.includes("limit")) return "boundary";
  if (techniqueLower.includes("action") || techniqueLower.includes("plan") || techniqueLower.includes("next step") || techniqueLower.includes("offer")) return "action";
  if (techniqueLower.includes("question") || techniqueLower.includes("clarify") || techniqueLower.includes("ask")) return "question";
  if (techniqueLower.includes("validat") || techniqueLower.includes("empath") || techniqueLower.includes("reflect") || techniqueLower.includes("acknowledg")) return "validation";

  return "general";
}

function getNormalisedState(escalationState?: Partial<ClinicianStateSnapshot>): ClinicianStateSnapshot {
  return {
    level: escalationState?.level ?? 4,
    trust: escalationState?.trust ?? 4,
    willingness_to_listen: escalationState?.willingness_to_listen ?? 4,
    anger: escalationState?.anger ?? 5,
    frustration: escalationState?.frustration ?? 5,
  };
}

function buildAffect(profile: PatientEmotionProfile, level: number, techniqueStyle: ClinicianTechniqueStyle): string {
  const profileAffect: Record<PatientEmotionProfile, string> = {
    grief: "Warm, grounded, and gentle enough to hold grief without sounding mournful yourself.",
    fear: "Calming, containing, and steady enough to lower the temperature in a frightened room.",
    entitlement: "Professional and warm, but clearly not pulled into status games.",
    hostility: "Unflappable, composed, and emotionally solid under pressure.",
    frustration: "Patient, practical, and steady without sounding bureaucratic.",
    distrust: "Plain-spoken, credible, and non-defensive.",
    mixed: "Emotionally attuned, stable, and clearly in control of the interaction.",
  };

  const levelOverlay =
    level <= 3
      ? "Keep it conversational and natural."
      : level <= 6
        ? "Add extra grounding and reassurance so the voice actively settles the interaction."
        : "Make it clearly containing: lower arousal, quieter authority, and emotional steadiness under pressure.";

  const techniqueOverlay: Record<ClinicianTechniqueStyle, string> = {
    validation: "Let the validating phrase land warmly, then return to steadiness.",
    action: "Carry quiet forward motion, as if the next safe step is clear.",
    boundary: "Add a firmer edge and calm authority without sounding punitive.",
    question: "Keep it invitational and attentive.",
    general: "Stay warm, controlled, and clinically grounded.",
  };

  return `${profileAffect[profile]} ${levelOverlay} ${techniqueOverlay[techniqueStyle]}`;
}

function buildTone(
  profile: PatientEmotionProfile,
  state: ClinicianStateSnapshot,
  techniqueStyle: ClinicianTechniqueStyle
): string {
  const parts: string[] = [];

  if (state.trust <= 2) {
    parts.push("Non-defensive, calm, and quietly credible.");
  } else if (state.trust <= 5) {
    parts.push("Reassuring but not sugary. Calm, professional, and believable.");
  } else {
    parts.push("Warm, collaborative, and confident without becoming casual or matey.");
  }

  if (state.willingness_to_listen <= 3) {
    parts.push("Use economical phrasing that can cut through when the patient is barely taking anything in.");
  }

  if (state.anger >= 7 || profile === "hostility") {
    parts.push("Keep a firmer, lower-energy authority so it never sounds tentative.");
  }

  if (profile === "grief") {
    parts.push("Avoid over-brightness; let the warmth feel respectful.");
  } else if (profile === "fear") {
    parts.push("Lean slightly more reassuring and containing, with no trace of panic.");
  } else if (profile === "distrust") {
    parts.push("Be plain-spoken and transparent, never polished in a way that sounds evasive.");
  }

  if (techniqueStyle === "boundary") {
    parts.push("Boundary-setting should sound composed, direct, and immovable.");
  } else if (techniqueStyle === "action") {
    parts.push("Practical next-step phrases should feel clear and confidence-building.");
  }

  return parts.join(" ");
}

function buildPacing(state: ClinicianStateSnapshot, techniqueStyle: ClinicianTechniqueStyle): string {
  const parts: string[] = [];

  if (state.level <= 3) {
    parts.push("Natural conversational rhythm. Smooth and responsive, not slow for the sake of sounding calm.");
  } else if (state.level <= 6) {
    parts.push("Slightly slower and more deliberate than everyday conversation, with short thought-sized chunks.");
  } else {
    parts.push("Deliberate and regulating. Short clauses, clean transitions, and no rush even if the other person is highly escalated.");
  }

  if (state.willingness_to_listen <= 3) {
    parts.push("Do not leave long reflective gaps that could feel hesitant or give the patient room to talk over you.");
  } else {
    parts.push("Allow brief natural pauses after the validating phrase or practical next step.");
  }

  if (techniqueStyle === "validation") {
    parts.push("Let the first empathic phrase breathe slightly, then tighten the pace on the rest.");
  } else if (techniqueStyle === "action") {
    parts.push("Keep the pace moving once you reach the concrete plan.");
  } else if (techniqueStyle === "boundary") {
    parts.push("Use clipped certainty rather than long, theatrical pauses.");
  }

  parts.push("Avoid line-by-line stop-start delivery and avoid sounding like you are reading a script.");

  return parts.join(" ");
}

function buildEmotion(profile: PatientEmotionProfile, state: ClinicianStateSnapshot): string {
  const emotionalFocus: Record<PatientEmotionProfile, string> = {
    grief: "Deep empathy held in restraint. Let compassion be audible, but do not mirror the grief so much that you sound destabilised.",
    fear: "Quiet reassurance and containment. Sound like a calm nervous system the patient can borrow.",
    entitlement: "Controlled professionalism. Helpful, but not appeasing or intimidated.",
    hostility: "Composed resolve. You care, but your emotional centre does not move with the hostility.",
    frustration: "Patient understanding with practical focus. No weariness, no exasperation.",
    distrust: "Earnest, transparent steadiness. Let honesty, not charm, carry the emotion.",
    mixed: "Warmth plus control. Attuned to distress while keeping the interaction safe and structured.",
  };

  const parts = [emotionalFocus[profile]];

  if (state.frustration >= 7) {
    parts.push("Add a little more grounding weight on practical phrases so they sound relieving rather than procedural.");
  }
  if (state.anger >= 7) {
    parts.push("Stay emotionally contained even when stressing key words; never snap back or sound reactive.");
  }

  return parts.join(" ");
}

function buildDelivery(
  context: ClinicianVoiceContext,
  state: ClinicianStateSnapshot,
  techniqueStyle: ClinicianTechniqueStyle
): string {
  const patientRole = context.patientRole || "patient";
  const clinicianRole = context.clinicianRole || "experienced NHS clinician";
  const technique = context.deescalationTechnique || "general de-escalation";
  const parts: string[] = [
    `Speak as an ${clinicianRole} in a live NHS conversation with a ${patientRole}.`,
    "Use a natural contemporary British English accent and British clinical phrasing, but keep it neutral and authentic rather than caricatured or overly posh.",
    "Sound human and present, not announcer-like, therapeutic in a fake way, or overly polished.",
    "Let emphasis fall on the validating phrase and the concrete next step, not on every sentence ending.",
    "Use expressive intonation, timing, and emphasis, but keep the overall read controlled and believable.",
  ];

  if (techniqueStyle === "boundary") {
    parts.push("Boundary language should have a firmer attack and cleaner finish, while staying respectful.");
  }
  if (techniqueStyle === "question") {
    parts.push("Questions should sound genuinely open, not rhetorical or prosecutorial.");
  }
  if (state.level >= 7) {
    parts.push("Keep the voice grounded and close; do not raise your own energy to match the patient.");
  }

  parts.push(`Current technique emphasis: ${technique}.`);

  return parts.join(" ");
}

export function buildClinicianVoiceInstructions(context: ClinicianVoiceContext): string {
  const state = getNormalisedState(context.escalationState);
  const profile = derivePatientEmotionProfile(context.emotionalDriver);
  const techniqueStyle = deriveTechniqueStyle(context.deescalationTechnique);

  return [
    "# Personality & Tone",
    "",
    "Accent: Natural contemporary British English.",
    `Voice affect: ${buildAffect(profile, state.level, techniqueStyle)}`,
    `Tone: ${buildTone(profile, state, techniqueStyle)}`,
    `Pacing: ${buildPacing(state, techniqueStyle)}`,
    `Emotion: ${buildEmotion(profile, state)}`,
    `Delivery: ${buildDelivery(context, state, techniqueStyle)}`,
    "Rules: Keep pauses brief and natural. Vary intonation and emphasis. Stay natural, spoken, and immediate rather than polished, performative, or robotic.",
  ].join("\n");
}

export function buildClinicianRealtimeInstructions(context: ClinicianVoiceContext): string {
  return [
    buildClinicianRealtimeIntro(context),
    "",
    buildClinicianVoiceInstructions(context),
    "",
    "Rules: Speak the line with natural continuity and spoken phrasing. Avoid stop-start delivery and avoid sounding like a TTS narrator.",
  ].join("\n");
}
