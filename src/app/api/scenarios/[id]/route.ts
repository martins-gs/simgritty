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
    .select("*, scenario_traits(*), scenario_voice_config(*), escalation_rules(*), scenario_milestones(*)")
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
  const { traits, voice_config, escalation_rules, publish, milestones, ...scenarioFields } = body;

  console.log("[Scenarios PUT] id:", id);
  console.log("[Scenarios PUT] milestones received:", JSON.stringify(milestones));
  console.log("[Scenarios PUT] support_threshold:", scenarioFields.support_threshold);
  console.log("[Scenarios PUT] scoring_weights:", JSON.stringify(scenarioFields.scoring_weights));

  // Update scenario
  const updateData = { ...scenarioFields };
  if (publish !== undefined) {
    updateData.status = publish ? "published" : "draft";
  }
  if (milestones !== undefined) {
    updateData.clinical_task_enabled = Array.isArray(milestones) && milestones.length > 0;
  }

  const { data: updateResult, error: scenarioError } = await supabase
    .from("scenario_templates")
    .update(updateData)
    .eq("id", id)
    .select("id, support_threshold, clinical_task_enabled")
    .single();

  if (scenarioError) {
    console.error("[Scenarios PUT] template update failed:", scenarioError.message, scenarioError.details, scenarioError.hint);
    return NextResponse.json({ error: scenarioError.message }, { status: 500 });
  }

  console.log("[Scenarios PUT] update result:", JSON.stringify(updateResult));

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

  // Replace milestones (delete + re-insert)
  if (milestones !== undefined) {
    console.log("[Scenarios PUT] processing milestones, count:", Array.isArray(milestones) ? milestones.length : "not array");

    const { error: deleteErr } = await supabase
      .from("scenario_milestones")
      .delete()
      .eq("scenario_template_id", id);
    if (deleteErr) {
      console.error("[Scenarios PUT] milestone delete failed:", deleteErr.message, deleteErr.details, deleteErr.hint);
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
    console.log("[Scenarios PUT] milestone delete OK");

    if (Array.isArray(milestones) && milestones.length > 0) {
      const milestoneRows = milestones.map((m: { description: string; classifier_hint: string }, i: number) => ({
        scenario_template_id: id,
        order: i,
        description: m.description,
        classifier_hint: m.classifier_hint,
      }));
      console.log("[Scenarios PUT] inserting milestones:", JSON.stringify(milestoneRows));
      const { data: insertResult, error: insertErr } = await supabase
        .from("scenario_milestones")
        .insert(milestoneRows)
        .select("id, description");
      if (insertErr) {
        console.error("[Scenarios PUT] milestone insert failed:", insertErr.message, insertErr.details, insertErr.hint);
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
      console.log("[Scenarios PUT] milestone insert result:", JSON.stringify(insertResult));
    } else {
      console.log("[Scenarios PUT] no milestones to insert (empty array)");
    }
  } else {
    console.log("[Scenarios PUT] milestones field undefined, skipping");
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
  await supabase.from("scenario_milestones").delete().eq("scenario_template_id", id);
  await supabase.from("escalation_rules").delete().eq("scenario_id", id);
  await supabase.from("scenario_voice_config").delete().eq("scenario_id", id);
  await supabase.from("scenario_traits").delete().eq("scenario_id", id);

  const { error } = await supabase.from("scenario_templates").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
