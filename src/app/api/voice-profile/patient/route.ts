import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePatientVoiceProfile } from "@/lib/openai/structuredVoice";
import type { EscalationState } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig } from "@/types/scenario";

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
  };

  if (!body.currentState || !body.traits || !body.voiceConfig) {
    return NextResponse.json({ error: "Missing patient voice profile context" }, { status: 400 });
  }

  const voiceProfile = await generatePatientVoiceProfile({
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
  });

  return NextResponse.json({ voiceProfile });
}
