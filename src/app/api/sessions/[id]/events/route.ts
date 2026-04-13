import { NextResponse } from "next/server";
import { loadOwnedSession } from "@/lib/supabase/ownedSession";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { sessionEventRequestBodySchema } from "@/lib/validation/schemas";

const CLINICIAN_AUDIO_FALLBACK_EVENT_TYPE = "classification_result";

function isEventTypeConstraintError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("event_type_check") ||
    normalized.includes("invalid input value for enum") ||
    normalized.includes("violates check constraint")
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: events, error } = await supabase
    .from("simulation_state_events")
    .select("*")
    .eq("session_id", id)
    .order("event_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(events);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownership = await loadOwnedSession(supabase, id, user.id);
  if (ownership.error) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status ?? 500 });
  }

  const parsed = await parseRequestJson(request, sessionEventRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;
  const baseInsert = {
    session_id: id,
    event_index: body.event_index,
    event_type: body.event_type,
    escalation_before: body.escalation_before,
    escalation_after: body.escalation_after,
    trust_before: body.trust_before,
    trust_after: body.trust_after,
    listening_before: body.listening_before,
    listening_after: body.listening_after,
    payload: body.payload || {},
  };

  const { error } = await supabase.from("simulation_state_events").insert(baseInsert);

  if (
    error &&
    body.event_type === "clinician_audio" &&
    isEventTypeConstraintError(error.message)
  ) {
    const { error: fallbackError } = await supabase.from("simulation_state_events").insert({
      ...baseInsert,
      event_type: CLINICIAN_AUDIO_FALLBACK_EVENT_TYPE,
      payload: {
        ...(body.payload || {}),
        __event_kind: "clinician_audio",
        __stored_event_type: CLINICIAN_AUDIO_FALLBACK_EVENT_TYPE,
      },
    });

    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        original_event_type: body.event_type,
        stored_event_type: CLINICIAN_AUDIO_FALLBACK_EVENT_TYPE,
      },
      { status: 201 }
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
