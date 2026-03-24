import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { voice, instructions } = body;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  // Create an ephemeral token via OpenAI's Realtime API
  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview",
      voice: voice || "alloy",
      instructions: instructions || "",
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
      },
      turn_detection: {
        type: "server_vad",
        threshold: 0.55,
        prefix_padding_ms: 300,
        silence_duration_ms: 450,
        create_response: true,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error("OpenAI Realtime session error:", errorData);
    return NextResponse.json(
      { error: "Failed to create realtime session" },
      { status: 500 }
    );
  }

  const data = await response.json();
  return NextResponse.json(data);
}
