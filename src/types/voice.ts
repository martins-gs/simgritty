export interface StructuredVoiceProfile {
  accent: string;
  voiceAffect: string;
  tone: string;
  pacing: string;
  emotion: string;
  delivery: string;
  variety: string;
}

export interface StructuredClinicianTurn {
  text: string;
  technique: string;
  voiceProfile: StructuredVoiceProfile;
}
