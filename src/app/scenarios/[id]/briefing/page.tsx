"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, ClipboardList, Mic, Play } from "lucide-react";
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

const DEFAULT_WARNING =
  "This simulation may include distressing content, including simulated verbal aggression.";

const DIFFICULTY_GUIDANCE: Record<string, string> = {
  low: "Expect a manageable conversation with space to think. The challenge is staying deliberate and consistent.",
  moderate:
    "Expect some emotional pressure or frustration, but still room to regain footing if you respond well.",
  high: "Expect sustained challenge. You may be interrupted, pushed, or met with strong emotion and will need to stay purposeful under pressure.",
  extreme:
    "Expect a demanding interaction with very little emotional slack. The test is whether you can stay clear, safe, and professional while the pressure stays high.",
};

function toParagraphs(value: string): string[] {
  return value
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toBullets(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s*-•\d.)]+/, "").trim())
    .filter(Boolean);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function BriefingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [scenario, setScenario] = useState<ScenarioData | null>(null);
  const [readyToStart, setReadyToStart] = useState(false);
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

  const briefingParagraphs = toParagraphs(scenario.pre_simulation_briefing_text);
  const objectives = toBullets(scenario.learning_objectives);
  const contentWarning = scenario.content_warning_text || DEFAULT_WARNING;
  const difficultyGuidance =
    DIFFICULTY_GUIDANCE[scenario.difficulty] ||
    "Expect a realistic, emotionally pressured interaction that asks you to stay calm, clear, and deliberate.";

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <Card className="mx-auto w-full max-w-3xl border-border/70 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="capitalize">
              {titleCase(scenario.difficulty)}
            </Badge>
            <Badge variant="secondary">{scenario.setting}</Badge>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl leading-tight">{scenario.title}</CardTitle>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Take a moment to get oriented before you begin. This page is here to prepare you for the conversation,
              so you know what you are being asked to do and what will happen when the simulation starts.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
                <ClipboardList className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Briefing</h2>
                <p className="text-sm text-slate-600">
                  Be clear on your role, the task, and what competent performance looks like.
                </p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Your role</p>
                <p className="text-sm text-slate-900">{scenario.trainee_role}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">You will be speaking with</p>
                <p className="text-sm text-slate-900">{scenario.ai_role}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {briefingParagraphs.length > 0 ? (
                briefingParagraphs.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-relaxed text-slate-700">
                    {paragraph}
                  </p>
                ))
              ) : (
                <p className="text-sm leading-relaxed text-slate-700">
                  You are about to enter a realistic simulated conversation where you will need to stay grounded,
                  communicate clearly, and respond deliberately under pressure.
                </p>
              )}
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">What you are being tested on</p>
                {objectives.length > 0 ? (
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
                    {objectives.map((objective) => (
                      <li key={objective}>{objective}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm leading-relaxed text-slate-700">
                    Your ability to listen well, stay composed, and move the interaction toward a safe and useful next step.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">What success looks like</p>
                <p className="text-sm leading-relaxed text-slate-700">
                  Success does not mean making the other person calm immediately. It means noticing the pressure,
                  staying humane and professional, and applying the skills above clearly enough to keep the interaction
                  safe, purposeful, and clinically grounded.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">What kind of difficulty to expect</p>
                <p className="text-sm leading-relaxed text-slate-700">{difficultyGuidance}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-amber-950">Content warning</h2>
                <p className="text-sm text-amber-900/80">
                  The aim is to prepare you for the emotional tone of the scenario, not catch you off guard.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm leading-relaxed text-amber-950/90">
              <p>{contentWarning}</p>
              <p>
                This is a training exercise with no real patients involved. You can leave the scenario at any time if
                you need to.
              </p>
              {scenario.educator_facilitation_recommended && (
                <p>
                  This scenario is recommended with educator support available if that is an option for you.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <Mic className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-sky-950">Microphone access</h2>
                <p className="text-sm text-sky-900/80">
                  Your browser will ask for mic access as soon as you start, so you know what that prompt is for.
                </p>
              </div>
            </div>

            <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-sky-950/90">
              <li>
                PROLOG needs your microphone so the simulated patient or relative can hear you and respond in real time.
              </li>
              <li>
                Your voice is sent for live processing and transcription during the scenario, and the session is recorded
                as one mixed audio file of both sides so it can be reviewed afterwards.
              </li>
              <li>
                Once the simulation page shows <span className="font-semibold">Listening</span>, the scenario is live.
                You do not need to press anything else. You can mute your microphone temporarily if you need by
                pushing the mic icon.
              </li>
            </ul>
          </section>

          <div className="rounded-xl border border-border/70 bg-background p-4">
            <div className="flex items-center gap-3">
              <Switch
                id="ready-to-start"
                checked={readyToStart}
                onCheckedChange={setReadyToStart}
              />
              <Label htmlFor="ready-to-start" className="cursor-pointer text-sm leading-relaxed">
                I have read the briefing, content warning, and microphone guidance, and I am ready to start.
              </Label>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="outline" className="sm:flex-1" onClick={() => router.back()}>
              Go Back
            </Button>
            <Button
              className="sm:flex-1"
              size="lg"
              onClick={handleStart}
              disabled={starting || !readyToStart}
            >
              <Play className="mr-2 h-4 w-4" />
              {starting ? "Starting..." : "Start Simulation"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
