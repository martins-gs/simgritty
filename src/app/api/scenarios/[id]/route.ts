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

  const { data: scenario, error } = await supabase
    .from("scenario_templates")
    .select("*, scenario_traits(*), scenario_voice_config(*), escalation_rules(*)")
    .eq("id", id)
    .single();

  if (error || !scenario) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(scenario);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { traits, voice_config, escalation_rules, publish, ...scenarioFields } = body;

  // Update scenario
  const updateData = { ...scenarioFields };
  if (publish !== undefined) {
    updateData.status = publish ? "published" : "draft";
  }

  const { error: scenarioError } = await supabase
    .from("scenario_templates")
    .update(updateData)
    .eq("id", id);

  if (scenarioError) {
    return NextResponse.json({ error: scenarioError.message }, { status: 500 });
  }

  // Update child records
  if (traits) {
    await supabase
      .from("scenario_traits")
      .upsert({ scenario_id: id, ...traits }, { onConflict: "scenario_id" });
  }
  if (voice_config) {
    await supabase
      .from("scenario_voice_config")
      .upsert({ scenario_id: id, ...voice_config }, { onConflict: "scenario_id" });
  }
  if (escalation_rules) {
    await supabase
      .from("escalation_rules")
      .upsert({ scenario_id: id, ...escalation_rules }, { onConflict: "scenario_id" });
  }

  return NextResponse.json({ id });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Delete related sessions and their child records first
  const { data: sessions } = await supabase
    .from("simulation_sessions")
    .select("id")
    .eq("scenario_id", id);

  if (sessions && sessions.length > 0) {
    const sessionIds = sessions.map((s) => s.id);
    await supabase.from("educator_notes").delete().in("session_id", sessionIds);
    await supabase.from("simulation_state_events").delete().in("session_id", sessionIds);
    await supabase.from("transcript_turns").delete().in("session_id", sessionIds);
    await supabase.from("simulation_sessions").delete().in("id", sessionIds);
  }

  // Delete scenario child records
  await supabase.from("escalation_rules").delete().eq("scenario_id", id);
  await supabase.from("scenario_voice_config").delete().eq("scenario_id", id);
  await supabase.from("scenario_traits").delete().eq("scenario_id", id);

  const { error } = await supabase.from("scenario_templates").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
