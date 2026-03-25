import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function isSnapshotColumnError(message: string) {
  return [
    "trigger_type",
    "state_after",
    "patient_voice_profile_after",
    "patient_prompt_after",
  ].some((column) => message.includes(column));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: turns, error } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("session_id", id)
    .order("turn_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(turns);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const baseInsert = {
    session_id: id,
    turn_index: body.turn_index,
    speaker: body.speaker,
    content: body.content,
    audio_url: body.audio_url || null,
    classifier_result: body.classifier_result || null,
    started_at: body.started_at || undefined,
    duration_ms: body.duration_ms || null,
  };

  const snapshotInsert = {
    ...baseInsert,
    trigger_type: body.trigger_type || null,
    state_after: body.state_after || null,
    patient_voice_profile_after: body.patient_voice_profile_after || null,
    patient_prompt_after: body.patient_prompt_after || null,
  };

  let { error } = await supabase.from("transcript_turns").insert(snapshotInsert);

  if (error && isSnapshotColumnError(error.message)) {
    const retry = await supabase.from("transcript_turns").insert(baseInsert);
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (typeof body.turn_index !== "number") {
    return NextResponse.json({ error: "turn_index required" }, { status: 400 });
  }

  const snapshotUpdate = {
    classifier_result: body.classifier_result || null,
    trigger_type: body.trigger_type || null,
    state_after: body.state_after || null,
    patient_voice_profile_after: body.patient_voice_profile_after || null,
    patient_prompt_after: body.patient_prompt_after || null,
  };

  const { error } = await supabase
    .from("transcript_turns")
    .update(snapshotUpdate)
    .eq("session_id", id)
    .eq("turn_index", body.turn_index);

  if (error) {
    if (isSnapshotColumnError(error.message)) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
