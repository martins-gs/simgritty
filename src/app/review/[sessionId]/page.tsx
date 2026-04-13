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
import { computeScore, isSessionPreliminary } from "@/lib/engine/scoring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { mergeTraineeAudioDeliveryFromEvents } from "@/lib/review/traineeDelivery";
import { parseStoredReviewArtifacts } from "@/lib/review/artifacts";
import {
  heatmapShellClass,
  heatmapShellStyle,
  insightBadgeClass,
  insightHeroClass,
  insightStatClass,
  reviewHeroStyle,
} from "@/lib/ui/insightTheme";
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

  const storedArtifacts = parseStoredReviewArtifacts(session.review_artifacts);
  const summaryAttempted =
    Boolean(storedArtifacts?.summary) ||
    Boolean(storedArtifacts?.meta.summary && !storedArtifacts.meta.summary.failure_class);
  const timelineAttempted =
    Boolean(storedArtifacts?.timeline) ||
    Boolean(storedArtifacts?.meta.timeline && !storedArtifacts.meta.timeline.failure_class);
  if (summaryAttempted && timelineAttempted) {
    return false;
  }

  const missingSessionSummary =
    !session.exit_type ||
    session.peak_escalation_level == null ||
    !session.ended_at;
  const missingClinicianAudio =
    expectsClinicianAudio(turns, events) &&
    !events.some(isClinicianAudioEvent);

  return missingSessionSummary || missingClinicianAudio;
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
    <div className="overflow-hidden rounded-xl border border-amber-200 bg-[#fff7ed]">
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

interface ReviewPageLoadResult {
  session: SimulationSession | null;
  turns: TranscriptTurn[];
  events: SimulationStateEvent[];
  notes: EducatorNote[];
  sessionMissing: boolean;
}

const reviewPageLoadResultCache = new Map<string, ReviewPageLoadResult>();
const reviewPageLoadRequestCache = new Map<string, Promise<ReviewPageLoadResult>>();

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
      const cachedResult = attempts === 0
        ? reviewPageLoadResultCache.get(sessionId)
        : undefined;
      const loaded = cachedResult
        ? cachedResult
        : await (() => {
            let requestPromise = reviewPageLoadRequestCache.get(sessionId);
            if (!requestPromise) {
              requestPromise = (async () => {
                const [sessionRes, turnsRes, eventsRes, notesRes] = await Promise.all([
                  fetch(`/api/sessions/${sessionId}`, { cache: "no-store" }).catch(() => null),
                  fetch(`/api/sessions/${sessionId}/transcript`, { cache: "no-store" }).catch(() => null),
                  fetch(`/api/sessions/${sessionId}/events`, { cache: "no-store" }).catch(() => null),
                  fetch(`/api/sessions/${sessionId}/educator-notes`, { cache: "no-store" }).catch(() => null),
                ]);

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

                const mergedTurns = mergeTraineeAudioDeliveryFromEvents(nextTurns, nextEvents);
                const result: ReviewPageLoadResult = {
                  session: nextSession,
                  turns: mergedTurns,
                  events: nextEvents,
                  notes: nextNotes,
                  sessionMissing: sessionRes?.status === 404,
                };
                reviewPageLoadResultCache.set(sessionId, result);
                return result;
              })().finally(() => {
                reviewPageLoadRequestCache.delete(sessionId);
              });
              reviewPageLoadRequestCache.set(sessionId, requestPromise);
            }

            return requestPromise;
          })();
      if (cancelled) return;

      if (loaded.sessionMissing) {
        setSessionMissing(true);
        setSession(null);
        setTurns([]);
        setEvents([]);
        setNotes([]);
        setLoading(false);
        return;
      }

      setSessionMissing(false);
      setSession(loaded.session);
      setTurns(loaded.turns);
      setEvents(loaded.events);
      setNotes(loaded.notes);
      setLoading(false);

      const audioDeliveryTurnIndexes = loaded.turns.flatMap((turn) => (
        turn.speaker === "trainee" &&
        (turn.trainee_delivery_analysis || turn.classifier_result?.trainee_delivery_analysis)
          ? [turn.turn_index]
          : []
      ));
      console.info(
        `[Review] loaded turn-level trainee audio delivery turns=${audioDeliveryTurnIndexes.join(",") || "none"}`
      );

      // Fetch audio recording URL if available (non-blocking, once only)
      if (loaded.session?.recording_path && !audioFetchedRef.current) {
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

      if (attempts >= 8 || !needsReviewRefresh(loaded.session, loaded.turns, loaded.events)) {
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
  const traineeTurnCount = turns.filter((turn) => turn.speaker === "trainee").length;

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
        <section className={`${insightHeroClass} px-5 py-6 sm:px-7 sm:py-7`} style={reviewHeroStyle}>
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <span className={insightBadgeClass}>Session review</span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {scenarioTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/70">
                Review the encounter, capture your own reaction, and turn the next practice run
                into a narrower, clearer teaching target.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                    session.status === "completed"
                      ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200"
                      : "border-rose-400/30 bg-rose-400/15 text-rose-100"
                  )}
                >
                  {session.exit_type === "instant_exit" ? "Exited early" : session.status}
                </span>
                {duration && (
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-white/80">
                    {formatDuration(duration)}
                  </span>
                )}
                {session.started_at && (
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-medium text-white/80">
                    {new Date(session.started_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className={insightStatClass}>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Trainee turns</p>
                <p className="mt-1 text-2xl font-semibold text-white">{traineeTurnCount}</p>
              </div>
              <div className={insightStatClass}>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Peak escalation</p>
                <p className="mt-1 text-2xl font-semibold text-white">
                  {session.peak_escalation_level ?? "—"}
                </p>
              </div>
              <div className={`${insightStatClass} col-span-2 sm:col-span-1`}>
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Exit type</p>
                <p className="mt-1 text-sm font-semibold text-white capitalize">
                  {session.exit_type?.replace(/_/g, " ") ?? "Standard end"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
          <ReflectionPrompt sessionId={sessionId} />

          <ReviewSummaryCard
            sessionId={sessionId}
            session={session}
            turns={turns}
            learningObjectives={learningObjectives}
          />
        </div>

        <Card className={`${heatmapShellClass} gap-0 py-0 ring-0`} style={heatmapShellStyle}>
          <CardHeader className="border-b border-slate-200/70 px-5 pb-4 pt-5 sm:px-6">
            <CardTitle>Conversation Timeline</CardTitle>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-slate-600">
              The path and the analysis are meant to be read together: the timeline shows how the encounter moved, and the section beneath explains why those shifts mattered.
            </p>
          </CardHeader>
          <CardContent className="px-0">
            {session.started_at ? (
              <EscalationTimeline
                sessionId={sessionId}
                events={events}
                turns={turns}
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

          <div className={`${heatmapShellClass} p-5 sm:p-6`} style={heatmapShellStyle}>
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
              className="mt-4 border border-[#efba7d] bg-[#f8a757] text-[#4b2d12] shadow-[0_18px_32px_-24px_rgba(169,96,24,0.65)] hover:bg-[#f3b26c]"
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
            className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-[#e9eff5] p-1.5 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.18)]"
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
                  "rounded-xl px-3 py-2.5 text-xs font-medium transition-colors sm:text-sm",
                  activePanel === panel.value
                    ? "bg-slate-950 text-white shadow-[0_14px_30px_-22px_rgba(15,23,42,0.9)]"
                    : "text-slate-500 hover:bg-white/80 hover:text-slate-900"
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
              className={`${heatmapShellClass} py-0 ring-0`} style={heatmapShellStyle}
            >
              <CardHeader className="flex flex-col gap-3 border-b border-slate-200/70 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
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
              className={`${heatmapShellClass} py-0 ring-0`} style={heatmapShellStyle}
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
              className={`${heatmapShellClass} py-0 ring-0`} style={heatmapShellStyle}
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
