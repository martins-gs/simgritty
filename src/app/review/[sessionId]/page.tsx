"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { TranscriptViewer } from "@/components/review/TranscriptViewer";
import { EscalationTimeline } from "@/components/review/EscalationTimeline";
import { EventLog } from "@/components/review/EventLog";
import { EducatorNotes } from "@/components/review/EducatorNotes";
import { ScoreCard } from "@/components/review/ScoreCard";
import { KeyMoments } from "@/components/review/KeyMoments";
import { ReflectionPrompt } from "@/components/review/ReflectionPrompt";
import { computeScore, isSessionPreliminary, pickKeyMoments, getNextTimeTrySuggestion } from "@/lib/engine/scoring";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  TranscriptTurn,
  SimulationStateEvent,
  EducatorNote,
  SimulationSession,
  ClinicianAudioPayload,
} from "@/types/simulation";
import type { ScenarioMilestone, ScoringWeights } from "@/types/scenario";

function isClinicianAudioEvent(
  event: SimulationStateEvent
): event is SimulationStateEvent & { payload: ClinicianAudioPayload & { __event_kind?: string } } {
  if (typeof event.payload !== "object" || event.payload === null || !("turn_index" in event.payload)) {
    return false;
  }

  return (
    event.event_type === "clinician_audio" ||
    (event.payload as { __event_kind?: string }).__event_kind === "clinician_audio"
  );
}

function expectsClinicianAudio(
  turns: TranscriptTurn[],
  events: SimulationStateEvent[]
): boolean {
  if (turns.some((turn) => turn.speaker === "system")) {
    return true;
  }

  return events.some((event) => {
    const payload = event.payload as { source?: string } | null;
    return payload?.source === "bot_clinician";
  });
}

function needsReviewRefresh(
  session: SimulationSession | null,
  turns: TranscriptTurn[],
  events: SimulationStateEvent[]
): boolean {
  if (!session) return true;

  const missingSessionSummary =
    !session.exit_type ||
    session.peak_escalation_level == null ||
    !session.ended_at;
  const missingClinicianAudio =
    expectsClinicianAudio(turns, events) &&
    !events.some(isClinicianAudioEvent);

  return missingSessionSummary || missingClinicianAudio;
}

export default function ReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [events, setEvents] = useState<SimulationStateEvent[]>([]);
  const [notes, setNotes] = useState<EducatorNote[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const audioFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    async function load() {
      const [sessionRes, turnsRes, eventsRes, notesRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}`).catch(() => null),
        fetch(`/api/sessions/${sessionId}/transcript`).catch(() => null),
        fetch(`/api/sessions/${sessionId}/events`).catch(() => null),
        fetch(`/api/sessions/${sessionId}/educator-notes`).catch(() => null),
      ]);
      if (cancelled) return;

      const nextSession = sessionRes?.ok ? await sessionRes.json() as SimulationSession : null;
      const nextTurns = turnsRes?.ok ? await turnsRes.json() as TranscriptTurn[] : [];
      const nextEvents = eventsRes?.ok ? await eventsRes.json() as SimulationStateEvent[] : [];
      const nextNotes = notesRes?.ok ? await notesRes.json() as EducatorNote[] : [];
      if (cancelled) return;

      setSession(nextSession);
      setTurns(nextTurns);
      setEvents(nextEvents);
      setNotes(nextNotes);
      setLoading(false);

      // Fetch audio recording URL if available (non-blocking, once only)
      if (nextSession?.recording_path && !audioFetchedRef.current) {
        audioFetchedRef.current = true;
        fetch(`/api/sessions/${sessionId}/audio`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (!cancelled && data?.url) {
              setRecordingUrl(data.url);
              if (data.recordingStartedAt) {
                setRecordingStartedAt(data.recordingStartedAt);
              }
            }
          })
          .catch(() => {});
      }

      if (attempts >= 8 || !needsReviewRefresh(nextSession, nextTurns, nextEvents)) {
        return;
      }

      attempts += 1;
      retryTimeout = setTimeout(() => {
        void load();
      }, 750);
    }
    void load();

    return () => {
      cancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [sessionId]);

  if (loading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading review...
        </div>
      </AppShell>
    );
  }

  const scenarioTitle =
    (session as unknown as { scenario_templates?: { title?: string } })
      .scenario_templates?.title || "Simulation";

  const duration = session.started_at && session.ended_at
    ? Math.round(
        (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000
      )
    : null;

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  // Extract scoring configuration from scenario snapshot
  const snapshot = session.scenario_snapshot as Record<string, unknown>;
  const milestones: ScenarioMilestone[] =
    (snapshot.scenario_milestones as ScenarioMilestone[] | undefined) ?? [];
  const scoringWeights: ScoringWeights | null =
    (snapshot.scoring_weights as ScoringWeights | undefined) ?? null;
  const supportThreshold: number | null =
    (snapshot.support_threshold as number | undefined) ?? null;
  const criticalThreshold: number | null =
    (snapshot.critical_threshold as number | undefined) ?? null;
  const learningObjectives: string =
    (snapshot.learning_objectives as string | undefined) ?? "";

  // Clinician audio stats (unchanged from before)
  const clinicianAudioEvents = events.filter(isClinicianAudioEvent);
  const clinicianAudioByTurnIndex = new Map<number, ClinicianAudioPayload>();
  for (const event of clinicianAudioEvents) {
    clinicianAudioByTurnIndex.set((event.payload as ClinicianAudioPayload).turn_index, event.payload as ClinicianAudioPayload);
  }
  const clinicianAudioStats = clinicianAudioEvents.reduce(
    (acc, event) => {
      const payload = event.payload as ClinicianAudioPayload;
      acc.total++;
      if (payload.path === "tts") acc.tts++;
      if (payload.path === "realtime" && payload.realtime_outcome === "completed") acc.realtimeCompleted++;
      if (payload.path === "realtime" && payload.realtime_outcome === "partial") acc.realtimePartial++;
      if (payload.path === "none") acc.none++;
      return acc;
    },
    { total: 0, realtimeCompleted: 0, realtimePartial: 0, tts: 0, none: 0 }
  );
  const clinicianAudioSuccessRate = clinicianAudioStats.total > 0
    ? Math.round((clinicianAudioStats.realtimeCompleted / clinicianAudioStats.total) * 100)
    : null;
  const clinicianAudioExpected = expectsClinicianAudio(turns, events);
  const clinicianAudioHeadline = clinicianAudioSuccessRate !== null
    ? `${clinicianAudioSuccessRate}% RT`
    : clinicianAudioExpected
      ? "Missing"
      : "Not used";
  const clinicianAudioSubtext = clinicianAudioStats.total > 0
    ? `${clinicianAudioStats.realtimeCompleted} realtime, ${clinicianAudioStats.realtimePartial} partial, ${clinicianAudioStats.tts} TTS`
    : clinicianAudioExpected
      ? "AI clinician turns were present, but no audio telemetry was saved."
      : null;

  // Compute score with new system
  const score = computeScore({
    session,
    turns,
    events,
    milestones,
    weights: scoringWeights,
    supportThreshold,
    criticalThreshold,
  });

  const preliminary = isSessionPreliminary(score.turnCount);
  const keyMoments = pickKeyMoments(score.evidence);
  const suggestion = getNextTimeTrySuggestion(score);

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;
  const canRestartFromSelectedTurn = Boolean(selectedTurn?.state_after && selectedTurn?.patient_prompt_after);

  async function handleRestartFromSelectedTurn() {
    if (!selectedTurn) return;
    setRestarting(true);

    const res = await fetch(`/api/sessions/${sessionId}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turn_index: selectedTurn.turn_index,
        fork_label: `Retry from turn ${selectedTurn.turn_index}`,
      }),
    });

    if (!res.ok) {
      setRestarting(false);
      return;
    }

    const forked = await res.json() as { id: string };
    router.push(`/simulation/${forked.id}`);
  }

  return (
    <AppShell>
      <div className="space-y-4 sm:space-y-6 px-1 sm:px-0">
        {/* Header */}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{scenarioTitle}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={session.status === "completed" ? "default" : "destructive"}>
              {session.exit_type === "instant_exit" ? "Exited early" : session.status}
            </Badge>
            {session.peak_escalation_level && (
              <Badge variant="outline">
                Peak escalation: {session.peak_escalation_level}
              </Badge>
            )}
            {session.final_escalation_level && (
              <Badge variant="outline">
                Final: {session.final_escalation_level}
              </Badge>
            )}
            {duration && (
              <Badge variant="secondary">{formatDuration(duration)}</Badge>
            )}
            {session.started_at && (
              <Badge variant="secondary">
                {new Date(session.started_at).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </div>

        {/* Session validity gate */}
        {!score.sessionValid ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center space-y-3">
            <p className="text-sm text-amber-800 font-medium">
              This session ended before enough interaction occurred to generate a score.
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => router.back()}>
                Go back
              </Button>
              {canRestartFromSelectedTurn && (
                <Button size="sm" onClick={handleRestartFromSelectedTurn}>
                  Practise from this moment
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Score */}
            <ScoreCard score={score} preliminary={preliminary} />

            {/* Learning objectives (if defined) */}
            {learningObjectives && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  Learning Objectives
                </h3>
                <ul className="space-y-1">
                  {learningObjectives.split("\n").filter(Boolean).map((obj, i) => (
                    <li key={i} className="text-[13px] text-slate-700">{obj}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key moments */}
            <KeyMoments moments={keyMoments} turns={turns} />

            {/* Next time, try */}
            {suggestion && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
                <h3 className="text-[12px] font-medium uppercase tracking-wide text-blue-600 mb-1">
                  Next time, try
                </h3>
                <p className="text-[13px] text-slate-700">{suggestion}</p>
              </div>
            )}
          </>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 sm:gap-4">
          <Card>
            <CardHeader className="pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm text-muted-foreground">Turns</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <p className="text-xl sm:text-2xl font-bold">{turns.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm text-muted-foreground">Peak Level</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <p className="text-xl sm:text-2xl font-bold">{session.peak_escalation_level ?? "N/A"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm text-muted-foreground">Exit Type</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <p className="text-xl sm:text-2xl font-bold capitalize">
                {session.exit_type?.replace(/_/g, " ") ?? "N/A"}
              </p>
            </CardContent>
          </Card>
          <Card className="hidden sm:block">
            <CardHeader className="pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm text-muted-foreground">Events</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <p className="text-xl sm:text-2xl font-bold">{events.length}</p>
            </CardContent>
          </Card>
          <Card className="hidden lg:block">
            <CardHeader className="pb-1 sm:pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
              <CardTitle className="text-xs sm:text-sm text-muted-foreground">Clinician Audio</CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
              <p className="text-xl sm:text-2xl font-bold">{clinicianAudioHeadline}</p>
              {clinicianAudioSubtext && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {clinicianAudioSubtext}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Escalation Timeline — always visible on main screen */}
        <Card>
          <CardHeader>
            <CardTitle>Escalation Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {session.started_at ? (
              <EscalationTimeline
                events={events}
                maxCeiling={
                  (session.scenario_snapshot as { escalation_rules?: { max_ceiling?: number } })
                    ?.escalation_rules?.max_ceiling ?? 8
                }
                sessionStartedAt={session.started_at}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No timeline data available</p>
            )}
          </CardContent>
        </Card>

        {/* Transcript + Event Log + Educator Notes */}
        <Tabs defaultValue="transcript">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="notes">Educator Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="transcript" className="mt-4">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                  <CardTitle className="text-base">Transcript</CardTitle>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Select a turn to anchor notes or restart from that point.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={handleRestartFromSelectedTurn}
                  disabled={!canRestartFromSelectedTurn || restarting}
                  className="w-full sm:w-auto"
                >
                  {restarting ? "Restarting..." : "Restart From Turn"}
                </Button>
              </CardHeader>
              <CardContent className="p-0 h-[60vh] sm:h-[500px]">
                <TranscriptViewer
                  turns={turns}
                  onTurnSelect={setSelectedTurnId}
                  selectedTurnId={selectedTurnId}
                  clinicianAudioByTurnIndex={clinicianAudioByTurnIndex}
                  sessionRecordingUrl={recordingUrl}
                  sessionStartedAt={recordingStartedAt ?? session.started_at}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <Card>
              <CardContent className="p-0 h-[60vh] sm:h-[500px]">
                <EventLog
                  events={events}
                  sessionStartedAt={session.started_at || session.created_at}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <Card>
              <CardContent className="p-0 h-[60vh] sm:h-[500px]">
                <EducatorNotes
                  sessionId={sessionId}
                  notes={notes}
                  onNoteAdded={(note) => setNotes((prev) => [...prev, note])}
                  selectedTurnId={selectedTurnId}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Reflection prompt */}
        {score.sessionValid && (
          <ReflectionPrompt sessionId={sessionId} />
        )}
      </div>
    </AppShell>
  );
}
