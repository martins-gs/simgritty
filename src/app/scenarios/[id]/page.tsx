"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { ScenarioForm } from "@/components/scenarios/ScenarioForm";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";

export default function EditScenarioPage() {
  const { id } = useParams<{ id: string }>();
  const loadScenario = useScenarioStore((s) => s.loadScenario);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<string>("draft");
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [orgMaxCeiling, setOrgMaxCeiling] = useState<number>(10);

  useEffect(() => {
    // Fetch org ceiling in parallel with scenario data
    fetch("/api/org-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.max_escalation_ceiling) setOrgMaxCeiling(s.max_escalation_ceiling);
      })
      .catch(() => {});

    async function load() {
      const res = await fetch(`/api/scenarios/${id}`);
      if (!res.ok) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      const data = await res.json();

      // Flatten the nested relations into the store shape
      const traits = Array.isArray(data.scenario_traits)
        ? data.scenario_traits[0]
        : data.scenario_traits;
      const voice = Array.isArray(data.scenario_voice_config)
        ? data.scenario_voice_config[0]
        : data.scenario_voice_config;
      const rules = Array.isArray(data.escalation_rules)
        ? data.escalation_rules[0]
        : data.escalation_rules;

      setStatus(data.status);
      if (data.creator_name) setCreatorName(data.creator_name);
      // Flatten milestones from the API response
      const milestones = Array.isArray(data.scenario_milestones)
        ? data.scenario_milestones
            .sort((a: { order: number }, b: { order: number }) => a.order - b.order)
            .map((m: { id: string; description: string; classifier_hint: string }) => ({
              id: m.id,
              description: m.description,
              classifier_hint: m.classifier_hint,
            }))
        : [];

      loadScenario({
        title: data.title,
        setting: data.setting,
        trainee_role: data.trainee_role,
        ai_role: data.ai_role,
        backstory: data.backstory,
        emotional_driver: data.emotional_driver,
        difficulty: data.difficulty,
        archetype_tag: data.archetype_tag,
        learning_objectives: data.learning_objectives || "",
        pre_simulation_briefing_text: data.pre_simulation_briefing_text || "",
        content_warning_text: data.content_warning_text || "",
        educator_facilitation_recommended: data.educator_facilitation_recommended || false,
        support_threshold: data.support_threshold ?? null,
        critical_threshold: data.critical_threshold ?? null,
        scoring_weights: data.scoring_weights ?? null,
        milestones,
        ...(traits && {
          traits: {
            hostility: traits.hostility,
            frustration: traits.frustration,
            impatience: traits.impatience,
            trust: traits.trust,
            willingness_to_listen: traits.willingness_to_listen,
            sarcasm: traits.sarcasm,
            bias_intensity: traits.bias_intensity,
            bias_category: traits.bias_category,
            volatility: traits.volatility,
            boundary_respect: traits.boundary_respect,
            coherence: traits.coherence,
            repetition: traits.repetition,
            entitlement: traits.entitlement,
            interruption_likelihood: traits.interruption_likelihood,
            escalation_tendency: traits.escalation_tendency,
          },
        }),
        ...(voice && {
          voice_config: {
            voice_name: voice.voice_name,
            speaking_rate: Number(voice.speaking_rate),
            expressiveness_level: voice.expressiveness_level,
            anger_expression: voice.anger_expression,
            sarcasm_expression: voice.sarcasm_expression,
            pause_style: voice.pause_style,
            interruption_style: voice.interruption_style,
            turn_pause_allowance_ms: voice.turn_pause_allowance_ms ?? 0,
          },
        }),
        ...(rules && {
          escalation_rules: {
            initial_level: rules.initial_level,
            max_ceiling: rules.max_ceiling,
            auto_end_threshold: rules.auto_end_threshold,
            escalation_triggers: rules.escalation_triggers || [],
            deescalation_triggers: rules.deescalation_triggers || [],
          },
        }),
      });
      setLoading(false);
    }
    load();
  }, [id, loadScenario]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading scenario...
        </div>
      </AppShell>
    );
  }

  if (loadError) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <p>Failed to load scenario.</p>
          <Link
            href="/scenarios"
            className="text-[13px] font-medium text-primary hover:underline"
          >
            Back to scenarios
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
          Full RBAC permissions functionality will be implemented in next version. Current permissions are to enable management to view all features of the app.
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-semibold">Edit Scenario</h1>
              <Badge
                variant={status === "published" ? "default" : "secondary"}
                className="text-[10px]"
              >
                {status}
              </Badge>
            </div>
            {creatorName && (
              <p className="mt-0.5 text-[12px] text-muted-foreground">Created by {creatorName}</p>
            )}
          </div>
          <Link
            href={`/scenarios/${id}/briefing`}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-emerald-700"
          >
            <Play className="h-3.5 w-3.5" />
            Run simulation
          </Link>
        </div>
        <ScenarioForm scenarioId={id} orgMaxCeiling={orgMaxCeiling} />
      </div>
    </AppShell>
  );
}
