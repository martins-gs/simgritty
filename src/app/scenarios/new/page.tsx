"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ScenarioForm } from "@/components/scenarios/ScenarioForm";
import { useScenarioStore } from "@/store/scenarioStore";

export default function NewScenarioPage() {
  const reset = useScenarioStore((s) => s.reset);
  const [orgMaxCeiling, setOrgMaxCeiling] = useState<number>(10);

  useEffect(() => {
    reset();
    fetch("/api/org-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s?.max_escalation_ceiling) setOrgMaxCeiling(s.max_escalation_ceiling);
      })
      .catch(() => {});
  }, [reset]);

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">New Scenario</h1>
        <ScenarioForm orgMaxCeiling={orgMaxCeiling} />
      </div>
    </AppShell>
  );
}
