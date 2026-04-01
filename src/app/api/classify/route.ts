import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAIErrorMessage } from "@/lib/openai/client";
import {
  classifyClinicianUtterance,
  classifyPatientResponse,
  classifyUtterance,
} from "@/lib/engine/classifierPipeline";
import { parseRequestJson } from "@/lib/validation/http";
import { classifyRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const parsed = await parseRequestJson(request, classifyRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const { utterance, context, mode } = parsed.data;

  let result;
  try {
    result = mode === "patient_response"
      ? await classifyPatientResponse(utterance, context, apiKey)
      : mode === "clinician_utterance"
        ? await classifyClinicianUtterance(utterance, context, apiKey)
        : await classifyUtterance(utterance, context, apiKey);
  } catch (error) {
    console.error("Classification route error:", error);
    return NextResponse.json(
      {
        error: "Classification failed",
        detail: getOpenAIErrorMessage(error),
      },
      { status: 502 }
    );
  }

  return NextResponse.json(result);
}
