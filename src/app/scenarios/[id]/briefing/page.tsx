"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ConsentGate } from "@/components/simulation/ConsentGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";
import { toast } from "sonner";

interface ScenarioData {
  id: string;
  title: string;
  setting: string;
  trainee_role: string;
  ai_role: string;
  difficulty: string;
  pre_simulation_briefing_text: string;
  content_warning_text: string;
  educator_facilitation_recommended: boolean;
  learning_objectives: string;
}

export default function BriefingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioData | null>(null);
  const [consented, setConsented] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch(`/api/scenarios/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load scenario");
        return r.json();
      })
      .then(setScenario)
      .catch(() => setLoadError(true));
  }, [id]);

  async function handleStart() {
    setStarting(true);
    // Create session
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: id }),
    });

    if (!res.ok) {
      toast.error("Failed to start simulation. Please try again.");
      setStarting(false);
      return;
    }

    const { id: sessionId } = await res.json();
    router.push(`/simulation/${sessionId}`);
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Failed to load scenario. Please go back and try again.
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!consented) {
    return (
      <ConsentGate
        contentWarning={scenario.content_warning_text}
        educatorFacilitationRecommended={scenario.educator_facilitation_recommended}
        onConsent={() => setConsented(true)}
        onDecline={() => router.back()}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle>{scenario.title}</CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline">{scenario.difficulty}</Badge>
            <Badge variant="secondary">{scenario.setting}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Your Role</p>
            <p className="text-sm">{scenario.trainee_role}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">You will be speaking with</p>
            <p className="text-sm">{scenario.ai_role}</p>
          </div>
          {scenario.pre_simulation_briefing_text && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Briefing</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {scenario.pre_simulation_briefing_text}
              </p>
            </div>
          )}
          {scenario.learning_objectives && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Learning Objectives</p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {scenario.learning_objectives}
              </p>
            </div>
          )}
          <Button
            className="w-full"
            size="lg"
            onClick={handleStart}
            disabled={starting}
          >
            <Play className="mr-2 h-4 w-4" />
            {starting ? "Starting..." : "Start Simulation"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
