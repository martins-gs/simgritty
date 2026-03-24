import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  buildClinicianVoiceInstructionsFromProfile,
  buildClinicianVoiceInstructions,
  type ClinicianVoiceContext,
} from "@/lib/engine/clinicianVoiceBuilder";
import type { StructuredVoiceProfile } from "@/types/voice";

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const CLINICIAN_TTS_MODEL = process.env.OPENAI_TTS_CLINICIAN_MODEL || "gpt-4o-mini-tts";
const CLINICIAN_TTS_FALLBACK_MODEL = process.env.OPENAI_TTS_CLINICIAN_FALLBACK_MODEL || "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = process.env.OPENAI_TTS_DEFAULT_VOICE || "cedar";
const CLINICIAN_TTS_VOICE = process.env.OPENAI_TTS_CLINICIAN_VOICE || "cedar";
const DEFAULT_TTS_INSTRUCTIONS = "Speak in a natural British English accent. Warm, clear, and human. Avoid flat cadence and avoid sounding scripted.";

interface TtsRequestBody {
  text?: string;
  voice?: string;
  style?: "default" | "clinician";
  context?: ClinicianVoiceContext;
  voiceProfile?: StructuredVoiceProfile;
}

async function requestSpeech(options: {
  apiKey: string;
  model: string;
  input: string;
  voice: string;
  instructions: string;
  responseFormat: string;
}) {
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      input: options.input,
      voice: options.voice,
      instructions: options.instructions,
      response_format: options.responseFormat,
    }),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });

  const { text, voice, style, context, voiceProfile } = await request.json() as TtsRequestBody;
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

  const instructions = style === "clinician"
    ? voiceProfile
      ? buildClinicianVoiceInstructionsFromProfile(voiceProfile, context ?? {})
      : buildClinicianVoiceInstructions(context ?? {})
    : DEFAULT_TTS_INSTRUCTIONS;
  const resolvedModel = style === "clinician" ? CLINICIAN_TTS_MODEL : TTS_MODEL;
  const resolvedVoice = style === "clinician" ? (voice || CLINICIAN_TTS_VOICE) : (voice || DEFAULT_TTS_VOICE);
  const responseFormat = "mp3";

  let response = await requestSpeech({
    apiKey,
    model: resolvedModel,
    input: text,
    voice: resolvedVoice,
    instructions,
    responseFormat,
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("TTS error:", err);

    if (style === "clinician" && resolvedModel !== CLINICIAN_TTS_FALLBACK_MODEL) {
      response = await requestSpeech({
        apiKey,
        model: CLINICIAN_TTS_FALLBACK_MODEL,
        input: text,
        voice: resolvedVoice,
        instructions,
        responseFormat,
      });

      if (!response.ok) {
        const fallbackErr = await response.text();
        console.error("Clinician TTS fallback error:", fallbackErr);
        return NextResponse.json({ error: "TTS failed" }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: "TTS failed" }, { status: 500 });
    }
  }

  // Stream the audio back
  const audioBuffer = await response.arrayBuffer();
  return new NextResponse(audioBuffer, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
