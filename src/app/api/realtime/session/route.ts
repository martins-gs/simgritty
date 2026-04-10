import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { realtimeSessionRequestBodySchema } from "@/lib/validation/schemas";

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-1.5";
const DEFAULT_REALTIME_VOICE = process.env.OPENAI_REALTIME_DEFAULT_VOICE || "marin";
const DEFAULT_INPUT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_TURN_DETECTION = {
  type: "server_vad",
  threshold: 0.55,
  prefix_padding_ms: 300,
  silence_duration_ms: 320,
  interrupt_response: false,
  create_response: true,
} as const;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, realtimeSessionRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const { voice, instructions, outputOnly } = parsed.data;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const sessionConfig = outputOnly
    ? {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: instructions || "",
        audio: {
          output: {
            voice: voice || DEFAULT_REALTIME_VOICE,
          },
        },
      }
    : {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: instructions || "",
        audio: {
          input: {
            transcription: {
              model: DEFAULT_INPUT_TRANSCRIPTION_MODEL,
            },
            turn_detection: DEFAULT_TURN_DETECTION,
          },
          output: {
            voice: voice || DEFAULT_REALTIME_VOICE,
          },
        },
      };

  // Create an ephemeral client secret via the GA Realtime API.
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      session: sessionConfig,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error(
      `[Realtime Session] OpenAI error: status=${response.status} model=${REALTIME_MODEL}`,
      errorData,
    );
    return NextResponse.json(
      { error: "Failed to create realtime session", detail: errorData },
      { status: 500 }
    );
  }

  const data = await response.json();
  console.info(
    `[Realtime Session] OK — model=${REALTIME_MODEL}, ` +
    `has_client_secret=${!!data.value}, ` +
    `session_id=${typeof data.session?.id === "string" ? data.session.id : "unknown"}`
  );
  return NextResponse.json({
    ...data,
    model: data.session?.model ?? REALTIME_MODEL,
    client_secret: data.value ? { value: data.value } : null,
  });
}
