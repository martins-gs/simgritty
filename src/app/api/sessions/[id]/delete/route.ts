import { NextResponse } from "next/server";
import { invalidateScenarioHistoryArtifact } from "@/lib/review/scenarioHistoryArtifactsService";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership
  const { data: session } = await supabase
    .from("simulation_sessions")
    .select("trainee_id, scenario_id")
    .eq("id", id)
    .single();
  if (!session || session.trainee_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete child records first (cascade should handle it, but be explicit)
  const { error: notesErr } = await supabase.from("educator_notes").delete().eq("session_id", id);
  if (notesErr) {
    return NextResponse.json({ error: `Failed to delete notes: ${notesErr.message}` }, { status: 500 });
  }
  const { error: eventsErr } = await supabase.from("simulation_state_events").delete().eq("session_id", id);
  if (eventsErr) {
    return NextResponse.json({ error: `Failed to delete events: ${eventsErr.message}` }, { status: 500 });
  }
  const { error: turnsErr } = await supabase.from("transcript_turns").delete().eq("session_id", id);
  if (turnsErr) {
    return NextResponse.json({ error: `Failed to delete turns: ${turnsErr.message}` }, { status: 500 });
  }
  const { error } = await supabase.from("simulation_sessions").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await invalidateScenarioHistoryArtifact(createAdminClientIfAvailable() ?? supabase, {
      userId: user.id,
      scenarioId: session.scenario_id,
      reason: "session_deleted",
    });
  } catch (invalidateError) {
    console.error("[Scenario History] session delete invalidation failed", invalidateError);
  }

  return NextResponse.json({ success: true });
}
