import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const body = await request.json();

  const { error } = await supabase.from("simulation_state_events").insert({
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
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
