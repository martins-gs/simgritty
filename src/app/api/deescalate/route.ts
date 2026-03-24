import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { generateClinicianTurn } from "@/lib/openai/structuredVoice";
import type { EscalationState } from "@/types/escalation";
import type { StructuredVoiceProfile } from "@/types/voice";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    recentTurns,
    scenarioContext,
    emotionalDriver,
    patientRole,
    clinicianRole,
    escalationState,
    patientVoiceProfile,
  } = await request.json() as {
    recentTurns?: { speaker: string; content: string }[];
    scenarioContext?: string;
    emotionalDriver?: string;
    patientRole?: string;
    clinicianRole?: string;
    escalationState?: Partial<EscalationState>;
    patientVoiceProfile?: StructuredVoiceProfile | null;
  };

  let turn;
  try {
    turn = await generateClinicianTurn({
      scenarioContext: scenarioContext || "NHS de-escalation scenario",
      emotionalDriver: emotionalDriver || "",
      patientRole: patientRole || "patient",
      clinicianRole: clinicianRole || "experienced British NHS clinician",
      escalationState: escalationState ?? {},
      recentTurns: recentTurns ?? [],
      patientVoiceProfile: patientVoiceProfile ?? null,
    });
  } catch (error) {
    console.error("Clinician turn generation error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      return NextResponse.json(
        {
          error: "Clinician generation failed",
          detail: getOpenAIErrorMessage(error),
        },
        { status: 502 }
      );
    }
    throw error;
  }

  const fallbackVoiceProfile: StructuredVoiceProfile | null = null;

  return NextResponse.json({
    text: turn?.text || "I can see this is a difficult situation. Let me help.",
    technique: turn?.technique || "general de-escalation",
    voiceProfile: turn?.voiceProfile || fallbackVoiceProfile,
  });
}
