import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: sessions, error } = await supabase
    .from("simulation_sessions")
    .select("id, scenario_id, trainee_id, status, exit_type, final_escalation_level, peak_escalation_level, started_at, ended_at, scenario_templates(title)")
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Attach trainee display names and emails
  const traineeIds = [...new Set((sessions ?? []).map((s) => s.trainee_id).filter(Boolean))];
  const nameMap: Record<string, { display_name: string | null; email: string | null }> = {};
  if (traineeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, display_name, email")
      .in("id", traineeIds);
    for (const p of profiles ?? []) {
      nameMap[p.id] = { display_name: p.display_name, email: p.email };
    }
  }

  const enriched = (sessions ?? []).map((s) => ({
    ...s,
    trainee_name: nameMap[s.trainee_id]?.display_name ?? nameMap[s.trainee_id]?.email ?? null,
  }));

  return NextResponse.json(enriched);
}
