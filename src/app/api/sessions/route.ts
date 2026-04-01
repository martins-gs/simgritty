import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { createSessionRequestBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "No profile" }, { status: 403 });

  const parsed = await parseRequestJson(request, createSessionRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const { scenario_id } = parsed.data;

  // Load full scenario with relations for snapshot
  const { data: scenario, error: scenErr } = await supabase
    .from("scenario_templates")
    .select("*, scenario_traits(*), scenario_voice_config(*), escalation_rules(*), scenario_milestones(*)")
    .eq("id", scenario_id)
    .single();

  if (scenErr || !scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }

  // Create session with scenario snapshot
  const { data: session, error: sessErr } = await supabase
    .from("simulation_sessions")
    .insert({
      scenario_id,
      trainee_id: user.id,
      org_id: profile.org_id,
      status: "created",
      scenario_snapshot: scenario,
    })
    .select("id")
    .single();

  if (sessErr) {
    return NextResponse.json({ error: sessErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: session.id }, { status: 201 });
}
