import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const milestoneSchema = z.object({
  description: z.string().min(1).max(100),
  classifier_hint: z.string().max(300).default(""),
});

const scoringWeightsSchema = z.object({
  composure: z.number().min(0).max(1),
  de_escalation: z.number().min(0).max(1),
  clinical_task: z.number().min(0).max(1),
  support_seeking: z.number().min(0).max(1),
});

const scenarioSchema = z.object({
  title: z.string().min(1),
  setting: z.string().default(""),
  trainee_role: z.string().default(""),
  ai_role: z.string().default(""),
  backstory: z.string().default(""),
  emotional_driver: z.string().default(""),
  difficulty: z.enum(["low", "moderate", "high", "extreme"]).default("moderate"),
  archetype_tag: z.string().nullable().default(null),
  learning_objectives: z.string().default(""),
  pre_simulation_briefing_text: z.string().default(""),
  content_warning_text: z.string().default(""),
  educator_facilitation_recommended: z.boolean().default(false),
  // Scoring configuration
  support_threshold: z.number().int().min(1).max(10).nullable().default(null),
  critical_threshold: z.number().int().min(1).max(10).nullable().default(null),
  scoring_weights: scoringWeightsSchema.nullable().default(null),
  milestones: z.array(milestoneSchema).max(5).default([]),
  traits: z.object({
    emotional_intensity: z.number().min(0).max(10),
    hostility: z.number().min(0).max(10),
    frustration: z.number().min(0).max(10),
    impatience: z.number().min(0).max(10),
    trust: z.number().min(0).max(10),
    willingness_to_listen: z.number().min(0).max(10),
    sarcasm: z.number().min(0).max(10),
    bias_intensity: z.number().min(0).max(10),
    bias_category: z.string().default("none"),
    volatility: z.number().min(0).max(10),
    boundary_respect: z.number().min(0).max(10),
    coherence: z.number().min(0).max(10),
    repetition: z.number().min(0).max(10),
    entitlement: z.number().min(0).max(10),
    interruption_likelihood: z.number().min(0).max(10),
    escalation_tendency: z.number().min(0).max(10),
  }),
  voice_config: z.object({
    voice_name: z.string().default("alloy"),
    speaking_rate: z.number().min(0.5).max(2.0),
    expressiveness_level: z.number().min(0).max(10),
    anger_expression: z.number().min(0).max(10),
    sarcasm_expression: z.number().min(0).max(10),
    pause_style: z.enum(["natural", "short_clipped", "long_dramatic", "minimal"]),
    interruption_style: z.enum(["none", "occasional", "frequent", "aggressive"]),
  }),
  escalation_rules: z.object({
    initial_level: z.number().min(1).max(10),
    max_ceiling: z.number().min(1).max(10),
    auto_end_threshold: z.number().min(1).max(10).nullable(),
    escalation_triggers: z.array(z.object({ trigger: z.string(), delta: z.number() })).default([]),
    deescalation_triggers: z.array(z.object({ trigger: z.string(), delta: z.number() })).default([]),
  }),
  publish: z.boolean().default(false),
});

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

  const body = await request.json();
  const parsed = scenarioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

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
