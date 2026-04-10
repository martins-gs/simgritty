import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage } from "@/lib/openai/client";
import { analyzeTraineeDeliveryFromAudio } from "@/lib/openai/traineeDeliveryAnalysis";
import { parseRequestJson } from "@/lib/validation/http";
import { traineeDeliveryAnalysisRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, traineeDeliveryAnalysisRequestBodySchema);
  if (!parsed.success) return parsed.response;

  try {
    const deliveryAnalysis = await analyzeTraineeDeliveryFromAudio({
      utterance: parsed.data.utterance,
      scenarioContext: parsed.data.scenarioContext,
      currentEscalation: parsed.data.currentEscalation,
      recentTurns: parsed.data.recentTurns,
      audioBase64: parsed.data.audioBase64,
      durationMs: parsed.data.durationMs ?? null,
    });

    return NextResponse.json({ deliveryAnalysis });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Trainee delivery analysis failed",
        detail: getOpenAIErrorMessage(error),
      },
      { status: 502 }
    );
  }
}
