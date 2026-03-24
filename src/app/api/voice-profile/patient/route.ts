import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { generatePatientVoiceProfile } from "@/lib/openai/structuredVoice";
import type { EscalationState } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig } from "@/types/scenario";
import type { StructuredVoiceProfile } from "@/types/voice";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    title?: string;
    aiRole?: string;
    traineeRole?: string;
    backstory?: string;
    emotionalDriver?: string;
    setting?: string;
    traits?: ScenarioTraits;
    voiceConfig?: ScenarioVoiceConfig;
    currentState?: EscalationState;
    recentTurns?: { speaker: string; content: string }[];
    latestClinicianVoiceProfile?: StructuredVoiceProfile | null;
  };

  if (!body.currentState || !body.traits || !body.voiceConfig) {
    return NextResponse.json({ error: "Missing patient voice profile context" }, { status: 400 });
  }

  let voiceProfile;
  try {
    voiceProfile = await generatePatientVoiceProfile({
      title: body.title || "Simulation scenario",
      aiRole: body.aiRole || "Patient",
      traineeRole: body.traineeRole || "Clinician",
      backstory: body.backstory || "",
      emotionalDriver: body.emotionalDriver || "",
      setting: body.setting || "",
      traits: body.traits,
      voiceConfig: body.voiceConfig,
      currentState: body.currentState,
      recentTurns: body.recentTurns ?? [],
      latestClinicianVoiceProfile: body.latestClinicianVoiceProfile,
    });
  } catch (error) {
    console.error("Patient voice profile generation error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      return NextResponse.json(
        {
          error: "Patient voice profile generation failed",
          detail: getOpenAIErrorMessage(error),
        },
        { status: 502 }
      );
    }
    throw error;
  }

  return NextResponse.json({ voiceProfile });
}
