import type { StructuredVoiceProfile } from "@/types/voice";

export function renderVoiceProfileForPrompt(profile: StructuredVoiceProfile): string {
  return `# Personality & Tone

## Accent
${profile.accent}

## Voice Affect
${profile.voiceAffect}

## Tone
${profile.tone}

## Pacing
${profile.pacing}

## Emotion
${profile.emotion}

## Delivery
${profile.delivery}

## Variety
${profile.variety}`;
}

export function renderVoiceProfileForTts(
  profile: StructuredVoiceProfile,
  roleLine?: string
): string {
  const lines = [
    "# Personality & Tone",
    "",
    roleLine || "",
    `Accent: ${profile.accent}`,
    `Voice affect: ${profile.voiceAffect}`,
    `Tone: ${profile.tone}`,
    `Pacing: ${profile.pacing}`,
    `Emotion: ${profile.emotion}`,
    `Delivery: ${profile.delivery}`,
    `Variety: ${profile.variety}`,
  ].filter(Boolean);

  return lines.join("\n");
}
