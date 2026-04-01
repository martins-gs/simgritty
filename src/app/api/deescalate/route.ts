import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage } from "@/lib/openai/client";
import { generateClinicianTurn } from "@/lib/openai/structuredVoice";
import { parseRequestJson } from "@/lib/validation/http";
import { deescalateRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, deescalateRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const {
    recentTurns,
    scenarioContext,
    emotionalDriver,
    patientRole,
    clinicianRole,
    escalationState,
    patientVoiceProfile,
  } = parsed.data;

  let turn;
  try {
    turn = await generateClinicianTurn({
      scenarioContext,
      emotionalDriver,
      patientRole,
      clinicianRole,
      escalationState,
      recentTurns,
      patientVoiceProfile,
    });
  } catch (error) {
    console.error("Clinician turn generation error:", error);
    return NextResponse.json(
      {
        error: "Clinician generation failed",
        detail: getOpenAIErrorMessage(error),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    text: turn?.text || "I can see this is a difficult situation. Let me help.",
    technique: turn?.technique || "general de-escalation",
    voiceProfile: turn?.voiceProfile || null,
  });
}
