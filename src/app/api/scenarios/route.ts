import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { scenarioUpsertBodySchema } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("org_id, role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "educator"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await parseRequestJson(request, scenarioUpsertBodySchema);
  if (!parsed.success) return parsed.response;

  const { traits, voice_config, escalation_rules, publish, milestones, ...scenarioFields } = parsed.data;

  const hasMilestones = milestones.length > 0;

  // Create scenario
  const { data: scenario, error: scenarioError } = await supabase
    .from("scenario_templates")
    .insert({
      ...scenarioFields,
      clinical_task_enabled: hasMilestones,
      org_id: profile.org_id,
      created_by: user.id,
      status: publish ? "published" : "draft",
    })
    .select("id")
    .single();

  if (scenarioError) {
    return NextResponse.json({ error: scenarioError.message }, { status: 500 });
  }

  // Create child records in parallel
  const [traitsResult, voiceResult, rulesResult] = await Promise.all([
    supabase.from("scenario_traits").insert({ scenario_id: scenario.id, ...traits }),
    supabase.from("scenario_voice_config").insert({ scenario_id: scenario.id, ...voice_config }),
    supabase.from("escalation_rules").insert({
      scenario_id: scenario.id,
      ...escalation_rules,
    }),
  ]);

  const childError = traitsResult.error || voiceResult.error || rulesResult.error;
  if (childError) {
    return NextResponse.json({ error: childError.message }, { status: 500 });
  }

  // Insert milestones if any
  if (hasMilestones) {
    const milestoneRows = milestones.map((m, i) => ({
      scenario_template_id: scenario.id,
      order: i,
      description: m.description,
      classifier_hint: m.classifier_hint,
    }));
    const { error: milestoneError } = await supabase.from("scenario_milestones").insert(milestoneRows);
    if (milestoneError) {
      return NextResponse.json({ error: milestoneError.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: scenario.id }, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: scenarios, error } = await supabase
    .from("scenario_templates")
    .select("*, scenario_traits(*), scenario_voice_config(*), escalation_rules(*), scenario_milestones(*)")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(scenarios);
}
