import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage } from "@/lib/openai/client";
import { generatePatientVoiceProfile } from "@/lib/openai/structuredVoice";
import { parseRequestJson } from "@/lib/validation/http";
import { patientVoiceProfileRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, patientVoiceProfileRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;

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
    return NextResponse.json(
      {
        error: "Patient voice profile generation failed",
        detail: getOpenAIErrorMessage(error),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ voiceProfile });
}
