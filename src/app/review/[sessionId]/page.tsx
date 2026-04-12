"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { TranscriptViewer } from "@/components/review/TranscriptViewer";
import { EscalationTimeline } from "@/components/review/EscalationTimeline";
import { EventLog } from "@/components/review/EventLog";
import { EducatorNotes } from "@/components/review/EducatorNotes";
import { ScoreCard } from "@/components/review/ScoreCard";
import { ReflectionPrompt } from "@/components/review/ReflectionPrompt";
import { ReviewSummaryCard } from "@/components/review/ReviewSummaryCard";
import { ScenarioHistoryCoachCard } from "@/components/review/ScenarioHistoryCoachCard";
import { computeScore, isSessionPreliminary, pickKeyMoments } from "@/lib/engine/scoring";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mergeTraineeAudioDeliveryFromEvents } from "@/lib/review/traineeDelivery";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  TranscriptTurn,
  SimulationStateEvent,
  EducatorNote,
  SimulationSession,
  ClinicianAudioPayload,
} from "@/types/simulation";
import {
  getStoredEventKind,
  parseClinicianAudioPayload,
  parseEducatorNotes,
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseStringIdRecord,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

async function readJsonSafely<T>(
  res: Response,
  parser: (data: unknown) => T,
  fallback: T,
  label: string
): Promise<T> {
  try {
    return parser(await res.json());
  } catch (error) {
    console.error(`[Review] Failed to parse ${label} response`, error);
    return fallback;
  }
}

function isClinicianAudioEvent(
  event: SimulationStateEvent
): boolean {
  return (
    event.event_type === "clinician_audio" ||
    getStoredEventKind(event.payload) === "clinician_audio"
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
    const payload = parseClinicianAudioPayload(event.payload);
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
  const missingTraineeDeliveryAnalysis = turns.some(
    (turn) =>
      turn.speaker === "trainee" &&
      turn.classifier_result !== null &&
      turn.trainee_delivery_analysis == null &&
      turn.classifier_result.trainee_delivery_analysis == null
  );

  return missingSessionSummary || missingClinicianAudio || missingTraineeDeliveryAnalysis;
}

function ScorePlaceholderCard({
  turnCount,
  onBack,
  onRestart,
  canRestart,
  restarting,
}: {
  turnCount: number;
  onBack: () => void;
  onRestart: () => void;
  canRestart: boolean;
  restarting: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 overflow-hidden">
      <div className="border-b border-amber-200/80 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">
          Performance Score
        </p>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">
          Score unavailable for this session
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          This session did not include enough trainee turns to generate a performance score.
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="rounded-xl border border-white/90 bg-white/85 p-4 shadow-sm">
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">
            Trainee turns recorded
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{turnCount}</p>
          <p className="mt-2 text-[12px] leading-5 text-slate-500">
            Complete at least 3 trainee turns to unlock scoring. Reflection, the timeline, and the full transcript are still available on this page.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            Go back
          </Button>
          {canRestart && (
            <Button size="sm" onClick={onRestart} disabled={restarting}>
              {restarting ? "Restarting..." : "Practise from this moment"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

type ReviewPanel = "transcript" | "events" | "notes";

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
  const [retryingScenario, setRetryingScenario] = useState(false);
  const [activePanel, setActivePanel] = useState<ReviewPanel>("transcript");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [sessionMissing, setSessionMissing] = useState(false);
  const audioFetchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    async function load() {
      const [sessionRes, turnsRes, eventsRes, notesRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/sessions/${sessionId}/transcript`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/sessions/${sessionId}/events`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/sessions/${sessionId}/educator-notes`, { cache: "no-store" }).catch(() => null),
      ]);
      if (cancelled) return;

      const nextSession = sessionRes?.ok
        ? await readJsonSafely(sessionRes, parseSimulationSession, null, "session")
        : null;
      const nextTurns = turnsRes?.ok
        ? await readJsonSafely(turnsRes, parseTranscriptTurns, [], "transcript")
        : [];
      const nextEvents = eventsRes?.ok
        ? await readJsonSafely(eventsRes, parseSimulationEvents, [], "events")
        : [];
      const nextNotes = notesRes?.ok
        ? await readJsonSafely(notesRes, parseEducatorNotes, [], "notes")
        : [];
      if (cancelled) return;

      if (sessionRes?.status === 404) {
        setSessionMissing(true);
        setSession(null);
        setTurns([]);
        setEvents([]);
        setNotes([]);
        setLoading(false);
        return;
      }

      setSessionMissing(false);

      const mergedTurns = mergeTraineeAudioDeliveryFromEvents(nextTurns, nextEvents);

      setSession(nextSession);
      setTurns(mergedTurns);
      setEvents(nextEvents);
      setNotes(nextNotes);
      setLoading(false);

      const directAudioDeliveryTurnIndexes = nextTurns.flatMap((turn) => (
        turn.speaker === "trainee" &&
        (turn.trainee_delivery_analysis || turn.classifier_result?.trainee_delivery_analysis)
          ? [turn.turn_index]
          : []
      ));
      const audioDeliveryTurnIndexes = mergedTurns.flatMap((turn) => (
        turn.speaker === "trainee" &&
        (turn.trainee_delivery_analysis || turn.classifier_result?.trainee_delivery_analysis)
          ? [turn.turn_index]
          : []
      ));
      const fallbackAudioDeliveryTurnIndexes = audioDeliveryTurnIndexes.filter(
        (turnIndex) => !directAudioDeliveryTurnIndexes.includes(turnIndex)
      );
      console.info(
        `[Review] loaded trainee audio delivery turns=${audioDeliveryTurnIndexes.join(",") || "none"} direct=${directAudioDeliveryTurnIndexes.join(",") || "none"} fallback=${fallbackAudioDeliveryTurnIndexes.join(",") || "none"}`
      );

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

      if (attempts >= 8 || !needsReviewRefresh(nextSession, mergedTurns, nextEvents)) {
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

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading review...
        </div>
      </AppShell>
    );
  }

  if (sessionMissing || !session) {
    return (
      <AppShell>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-muted-foreground">
            This review session could not be found.
          </p>
          <div>
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const scenarioTitle =
    session.scenario_templates?.title || "Simulation";

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
  const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
  const milestones = snapshot.scenario_milestones;
  const scoringWeights = snapshot.scoring_weights;
  const supportThreshold = snapshot.support_threshold;
  const criticalThreshold = snapshot.critical_threshold;
  const learningObjectives = snapshot.learning_objectives;
  const scenarioTraits = snapshot.scenario_traits[0] ?? null;
  const scenarioBackstory = snapshot.backstory;
  const scenarioEmotionalDriver = snapshot.emotional_driver;
  const scenarioAiRole = snapshot.ai_role;

  const clinicianAudioEvents = events
    .filter(isClinicianAudioEvent)
    .flatMap((event) => {
      const payload = parseClinicianAudioPayload(event.payload);
      return payload ? [{ event, payload }] : [];
    });
  const clinicianAudioByTurnIndex = new Map<number, ClinicianAudioPayload>();
  for (const { payload } of clinicianAudioEvents) {
    clinicianAudioByTurnIndex.set(payload.turn_index, payload);
  }

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
  const timelineKeyMoments = pickKeyMoments(score.evidence, 8);

  const selectedTurn = turns.find((turn) => turn.id === selectedTurnId) ?? null;
  const canRestartFromSelectedTurn = Boolean(selectedTurn?.state_after && selectedTurn?.patient_prompt_after);

  async function handleRestartFromSelectedTurn() {
    if (!selectedTurn) return;
    setRestarting(true);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turn_index: selectedTurn.turn_index,
          fork_label: `Retry from turn ${selectedTurn.turn_index}`,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to create forked session");
        return;
      }

      const forked = parseStringIdRecord(await res.json());
      if (!forked) {
        throw new Error("Fork response invalid");
      }

      router.push(`/simulation/${forked.id}`);
    } catch {
      toast.error("Failed to restart from this turn");
    } finally {
      setRestarting(false);
    }
  }

  async function handleRetryScenario() {
    if (!session) {
      toast.error("Review session is still loading");
      return;
    }

    setRetryingScenario(true);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenario_id: session.scenario_id,
        }),
      });

      if (!res.ok) {
        toast.error("Failed to start another practice run");
        return;
      }

      const nextSession = parseStringIdRecord(await res.json());
      if (!nextSession) {
        throw new Error("Session response invalid");
      }

      router.push(`/simulation/${nextSession.id}`);
    } catch {
      toast.error("Failed to start another practice run");
    } finally {
      setRetryingScenario(false);
    }
  }

  const reviewPanels: Array<{ value: ReviewPanel; label: string }> = [
    { value: "transcript", label: "Transcript" },
    { value: "events", label: "Event Log" },
    { value: "notes", label: "Educator Notes" },
  ];

  return (
    <AppShell>
      <div className="space-y-4 sm:space-y-6 px-1 sm:px-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">{scenarioTitle}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={session.status === "completed" ? "default" : "destructive"}>
              {session.exit_type === "instant_exit" ? "Exited early" : session.status}
            </Badge>
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

        <div className="space-y-4">
          <ReflectionPrompt sessionId={sessionId} />

          {score.sessionValid && (
            <div className="space-y-4">
              <ReviewSummaryCard
                sessionId={sessionId}
                session={session}
                score={score}
                turns={turns}
                keyMoments={keyMoments}
                learningObjectives={learningObjectives}
                milestones={milestones}
                aiRole={scenarioAiRole}
                backstory={scenarioBackstory}
                emotionalDriver={scenarioEmotionalDriver}
                traits={scenarioTraits}
              />
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Conversation Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {session.started_at ? (
              <EscalationTimeline
                sessionId={sessionId}
                events={events}
                turns={turns}
                keyMoments={timelineKeyMoments}
                maxCeiling={snapshot.escalation_rules[0]?.max_ceiling ?? 8}
                sessionStartedAt={recordingStartedAt ?? session.started_at}
                recordingUrl={recordingUrl}
              />
            ) : (
              <p className="text-muted-foreground text-sm">No timeline data available</p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 pt-8 sm:space-y-8 sm:pt-10">
          <ScenarioHistoryCoachCard sessionId={sessionId} />

          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-amber-50 p-5 shadow-sm">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Next practice run
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">
                Ready to try again?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Practice makes progress. Run the same scenario again and see if you can apply the coaching above earlier, more clearly, and with less effort.
              </p>
            </div>

            <Button
              size="lg"
              onClick={handleRetryScenario}
              disabled={retryingScenario}
              className="mt-4"
            >
              {retryingScenario ? "Starting another run..." : "Retry This Scenario"}
            </Button>
          </div>

        </div>

        <div className="space-y-4 pt-10 sm:pt-14">
          <div className="max-w-3xl space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Session breakdown
            </p>
            <p className="text-[13px] leading-relaxed text-slate-500">
              Use the transcript, event log, and educator notes if you want to revisit the raw detail behind the coaching above.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Review sections"
            className="grid grid-cols-3 gap-1 rounded-lg border border-border/60 bg-muted/40 p-1"
          >
            {reviewPanels.map((panel) => (
              <button
                key={panel.value}
                id={`review-tab-${panel.value}`}
                type="button"
                role="tab"
                aria-controls={`review-panel-${panel.value}`}
                aria-selected={activePanel === panel.value}
                onClick={() => setActivePanel(panel.value)}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-medium transition-colors sm:text-sm",
                  activePanel === panel.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                {panel.label}
              </button>
            ))}
          </div>

          {activePanel === "transcript" && (
            <Card
              id="review-panel-transcript"
              role="tabpanel"
              aria-labelledby="review-tab-transcript"
            >
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
                  className="hidden sm:inline-flex"
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
              <div className="border-t px-4 py-3 sm:hidden">
                <p className="text-xs text-muted-foreground">
                  {selectedTurn
                    ? canRestartFromSelectedTurn
                      ? `Turn ${selectedTurn.turn_index} selected for restart.`
                      : `Turn ${selectedTurn.turn_index} selected, but restart is not available from that point.`
                    : "Select a transcript turn to restart from that point."}
                </p>
                <Button
                  size="sm"
                  onClick={handleRestartFromSelectedTurn}
                  disabled={!canRestartFromSelectedTurn || restarting}
                  className="mt-3 w-full"
                >
                  {restarting ? "Restarting..." : "Restart From Turn"}
                </Button>
              </div>
            </Card>
          )}

          {activePanel === "events" && (
            <Card
              id="review-panel-events"
              role="tabpanel"
              aria-labelledby="review-tab-events"
            >
              <CardContent className="p-0 h-[60vh] sm:h-[500px]">
                <EventLog
                  events={events}
                  sessionStartedAt={session.started_at || session.created_at}
                />
              </CardContent>
            </Card>
          )}

          {activePanel === "notes" && (
            <Card
              id="review-panel-notes"
              role="tabpanel"
              aria-labelledby="review-tab-notes"
            >
              <CardContent className="p-0 h-[60vh] sm:h-[500px]">
                <EducatorNotes
                  sessionId={sessionId}
                  notes={notes}
                  onNoteAdded={(note) => setNotes((prev) => [...prev, note])}
                  selectedTurnId={selectedTurnId}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="pt-2 sm:pt-4">
          {score.sessionValid ? (
            <ScoreCard score={score} preliminary={preliminary} />
          ) : (
            <ScorePlaceholderCard
              turnCount={score.turnCount}
              onBack={() => router.back()}
              onRestart={handleRestartFromSelectedTurn}
              canRestart={canRestartFromSelectedTurn}
              restarting={restarting}
            />
          )}
        </div>

      </div>
    </AppShell>
  );
}
