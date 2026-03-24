import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: sessions, error } = await supabase
    .from("simulation_sessions")
    .select("id, scenario_id, status, exit_type, final_escalation_level, peak_escalation_level, started_at, ended_at, scenario_templates(title)")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(sessions);
}
