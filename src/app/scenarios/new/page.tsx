"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ScenarioForm } from "@/components/scenarios/ScenarioForm";
import { useScenarioStore } from "@/store/scenarioStore";

export default function NewScenarioPage() {
  const reset = useScenarioStore((s) => s.reset);

  useEffect(() => {
    reset();
  }, [reset]);

  return (
    <AppShell>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">New Scenario</h1>
        <ScenarioForm />
      </div>
    </AppShell>
  );
}
