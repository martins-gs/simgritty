import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage } from "@/lib/openai/client";
import { generateTraineeVoiceProfile } from "@/lib/openai/structuredVoice";
import { parseRequestJson } from "@/lib/validation/http";
import { traineeVoiceProfileRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, traineeVoiceProfileRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;

  let voiceProfile;
  try {
    voiceProfile = await generateTraineeVoiceProfile({
      utterance: body.utterance,
      scenarioContext: body.scenarioContext,
      currentEscalation: body.currentEscalation,
      recentTurns: body.recentTurns,
    });
  } catch (error) {
    console.error("Trainee voice profile generation error:", error);
    return NextResponse.json(
      {
        error: "Trainee voice profile generation failed",
        detail: getOpenAIErrorMessage(error),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ voiceProfile });
}
