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

  // Update session status to active
  const { error } = await supabase
    .from("simulation_sessions")
    .update({
      status: "active",
      started_at: new Date().toISOString(),
      trainee_consented_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("trainee_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log session started event
  await supabase.from("simulation_state_events").insert({
    session_id: id,
    event_index: 0,
    event_type: "session_started",
    payload: { started_by: user.id },
  });

  return NextResponse.json({ success: true });
}
