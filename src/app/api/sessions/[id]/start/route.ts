import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: session, error: sessionError } = await supabase
    .from("simulation_sessions")
    .select("id, started_at, trainee_consented_at")
    .eq("id", id)
    .eq("trainee_id", user.id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updatePayload: Record<string, string> = {
    status: "active",
    trainee_consented_at: session.trainee_consented_at || now,
  };

  if (!session.started_at) {
    updatePayload.started_at = now;
  }

  const { error } = await supabase
    .from("simulation_sessions")
    .update(updatePayload)
    .eq("id", id)
    .eq("trainee_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count } = await supabase
    .from("simulation_state_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", id)
    .eq("event_type", "session_started");

  if (!count) {
    await supabase.from("simulation_state_events").insert({
      session_id: id,
      event_index: 0,
      event_type: "session_started",
      payload: { started_by: user.id },
    });
  }

  return NextResponse.json({ success: true });
}
