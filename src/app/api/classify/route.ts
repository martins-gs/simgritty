import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  classifyClinicianUtterance,
  classifyPatientResponse,
  classifyUtterance,
  type ClassifierContext,
  type ClassifierMode,
} from "@/lib/engine/classifierPipeline";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const { utterance, context, mode } = await request.json() as {
    utterance?: string;
    context?: ClassifierContext;
    mode?: ClassifierMode;
  };

  if (!utterance || !context) {
    return NextResponse.json({ error: "utterance and context required" }, { status: 400 });
  }

  let result;
  try {
    result = mode === "patient_response"
      ? await classifyPatientResponse(utterance, context, apiKey)
      : mode === "clinician_utterance"
        ? await classifyClinicianUtterance(utterance, context, apiKey)
        : await classifyUtterance(utterance, context, apiKey);
  } catch (error) {
    console.error("Classification route error:", error);
    if (shouldFailLoudOnOpenAIError()) {
      return NextResponse.json(
        {
          error: "Classification failed",
          detail: getOpenAIErrorMessage(error),
        },
        { status: 502 }
      );
    }
    throw error;
  }

  return NextResponse.json(result);
}
