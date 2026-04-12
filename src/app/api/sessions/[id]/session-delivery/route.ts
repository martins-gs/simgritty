import { NextResponse } from "next/server";
import { analyzeSessionDeliveryFromAudio } from "@/lib/openai/sessionDeliveryAnalysis";
import { getSessionAudioDeliveryFromEvents } from "@/lib/review/traineeDelivery";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

function buildScenarioContext(snapshot: ReturnType<typeof parseScenarioSnapshot>) {
  return [
    snapshot.title,
    snapshot.setting,
    `${snapshot.ai_role} speaking with ${snapshot.trainee_role}.`,
    snapshot.emotional_driver ? `Emotional driver: ${snapshot.emotional_driver}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: sessionRow, error: sessionError } = await authSupabase
    .from("simulation_sessions")
    .select("id, trainee_id, scenario_snapshot")
    .eq("id", id)
    .eq("trainee_id", user.id)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: eventRows, error: eventError }] = await Promise.all([
    authSupabase
      .from("transcript_turns")
      .select("*")
      .eq("session_id", id)
      .order("turn_index", { ascending: true }),
    authSupabase
      .from("simulation_state_events")
      .select("*")
      .eq("session_id", id)
      .order("event_index", { ascending: true }),
  ]);

  if (transcriptError) {
    return NextResponse.json({ error: transcriptError.message }, { status: 500 });
  }

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  const events = parseSimulationEvents(eventRows ?? []);
  const existingAnalysis = getSessionAudioDeliveryFromEvents(events);
  if (existingAnalysis) {
    return NextResponse.json({ deliveryAnalysis: existingAnalysis, cached: true });
  }

  const turns = parseTranscriptTurns(transcriptRows ?? []);
  const traineeTurnCount = turns.filter((turn) => turn.speaker === "trainee").length;
  if (traineeTurnCount < 2) {
    return NextResponse.json({ deliveryAnalysis: null, cached: false });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const durationMsRaw = formData.get("duration_ms");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  const audioBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const snapshot = parseScenarioSnapshot(sessionRow.scenario_snapshot);
  const parsedDurationMs =
    typeof durationMsRaw === "string" && durationMsRaw.trim()
      ? Number(durationMsRaw)
      : null;

  try {
    const deliveryAnalysis = await analyzeSessionDeliveryFromAudio({
      scenarioContext: buildScenarioContext(snapshot),
      transcriptTurns: turns,
      audioBase64,
      durationMs:
        typeof parsedDurationMs === "number" && Number.isFinite(parsedDurationMs)
          ? parsedDurationMs
          : null,
    });

    if (!deliveryAnalysis) {
      return NextResponse.json({ deliveryAnalysis: null, cached: false });
    }

    const persistSupabase = createAdminClientIfAvailable() ?? authSupabase;
    const nextEventIndex = events.reduce(
      (max, event) => Math.max(max, event.event_index),
      -1
    ) + 1;
    const { error: insertError } = await persistSupabase
      .from("simulation_state_events")
      .insert({
        session_id: id,
        event_index: nextEventIndex,
        event_type: "classification_result",
        escalation_before: null,
        escalation_after: null,
        trust_before: null,
        trust_after: null,
        listening_before: null,
        listening_after: null,
        payload: {
          __event_kind: "session_audio_delivery",
          source: "session_audio_delivery",
          delivery_analysis: deliveryAnalysis,
        },
      });

    if (insertError) {
      console.error("[Session Delivery] Failed to persist analysis event", insertError);
    }

    return NextResponse.json({ deliveryAnalysis, cached: false });
  } catch (error) {
    console.error("[Session Delivery] analysis failed", error);
    const message = error instanceof Error ? error.message : "Unknown OpenAI error";
    return NextResponse.json(
      { error: "Session delivery analysis failed", detail: message },
      { status: 502 }
    );
  }
}
