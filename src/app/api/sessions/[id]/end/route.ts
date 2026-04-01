import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { endSessionRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, endSessionRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const { exit_type, final_escalation_level, peak_escalation_level } = parsed.data;

  const { error } = await supabase
    .from("simulation_sessions")
    .update({
      status: exit_type === "instant_exit" ? "aborted" : "completed",
      ended_at: new Date().toISOString(),
      exit_type: exit_type || "normal",
      final_escalation_level,
      peak_escalation_level,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get event count for index
  const { count } = await supabase
    .from("simulation_state_events")
    .select("*", { count: "exact", head: true })
    .eq("session_id", id);

  await supabase.from("simulation_state_events").insert({
    session_id: id,
    event_index: (count || 0),
    event_type: exit_type === "instant_exit" ? "trainee_exit" : "session_ended",
    escalation_after: final_escalation_level,
    payload: { exit_type, peak_escalation_level },
  });

  return NextResponse.json({ success: true });
}
