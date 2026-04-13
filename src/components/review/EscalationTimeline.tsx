"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MomentTranscriptContext } from "@/components/review/MomentTranscriptContext";
import { heatmapSoftCardClass, heatmapSoftCardStyle } from "@/lib/ui/insightTheme";
import {
  reviewDebugSchema,
  reviewTimelineApiResponseSchema,
  getMomentTurnContext,
  type GeneratedTimelineNarrative,
} from "@/lib/review/feedback";
import type { SimulationStateEvent, TranscriptTurn } from "@/types/simulation";
import { cn } from "@/lib/utils";

interface EscalationTimelineProps {
  sessionId: string;
  events: SimulationStateEvent[];
  turns: TranscriptTurn[];
  maxCeiling: number;
  sessionStartedAt: string;
  recordingUrl?: string | null;
  onActiveKeyMomentChange?: (index: number | null) => void;
}

interface ChartPoint {
  time: number;
  level: number;
  type: string;
}

interface KeyMomentEntry {
  index: number;
  narrative: GeneratedTimelineNarrative;
  time: number;
}

const timelineNarrativeResultCache = new Map<string, {
  narratives: GeneratedTimelineNarrative[];
  debug: z.infer<typeof reviewDebugSchema>;
}>();
const timelineNarrativeRequestCache = new Map<string, Promise<{
  narratives: GeneratedTimelineNarrative[];
  debug: z.infer<typeof reviewDebugSchema>;
}>>();

const CHART_MARGIN = { top: 8, right: 24, bottom: 6, left: 0 };
const PLAYBACK_CARD_DURATION_MS = 15_000;

function getEventDotColor(type: string) {
  if (type === "escalation_change") return "#ef4444";
  if (type === "de_escalation_change") return "#10b981";
  if (type === "ceiling_reached") return "#991b1b";
  if (type === "session_started" || type === "session_ended") return "#64748b";
  return "#94a3b8";
}

function getRelativeTime(timestamp: string, startTime: number) {
  return Math.max(0, (new Date(timestamp).getTime() - startTime) / 1000);
}

function getTurnCueTime(turn: TranscriptTurn, startTime: number) {
  return getRelativeTime(turn.started_at, startTime);
}

function formatTime(secs: number) {
  const wholeSeconds = Math.max(0, Math.floor(secs));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function snapToSecond(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.floor(seconds));
}

function getChartPointAtTime(data: ChartPoint[], time: number | null) {
  if (!data.length || time === null) return null;

  let point = data[0];
  for (const entry of data) {
    if (entry.time > time) break;
    point = entry;
  }

  return point;
}

function getKeyMomentAtTime(entries: KeyMomentEntry[], time: number | null) {
  if (!entries.length || time === null) return null;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].time <= time) {
      return entries[index];
    }
  }

  return null;
}

function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;

  const color = getEventDotColor(payload.type);
  const radius = payload.type === "ceiling_reached"
    ? 5
    : payload.type === "session_started" || payload.type === "session_ended"
      ? 3
      : 4;

  return (
    <g>
      <circle cx={cx} cy={cy} r={radius + 2} fill={color} opacity={0.12} />
      <circle cx={cx} cy={cy} r={radius} fill="white" stroke={color} strokeWidth={2} />
    </g>
  );
}

function TimelineMomentCard({
  entry,
  turns,
  showNow,
}: {
  entry: KeyMomentEntry;
  turns: TranscriptTurn[];
  showNow: boolean;
}) {
  const context = getMomentTurnContext(turns, entry.narrative.turnIndex);
  const lens = entry.narrative.lens?.trim() || (entry.narrative.positive ? "Helpful moment" : "Moment to revisit");

  return (
    <div className="w-full rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.28)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {entry.narrative.timecode} • {lens}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
            entry.narrative.positive
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-800"
          )}
        >
          {entry.narrative.positive ? "Helpful moment" : "Moment to revisit"}
        </span>
        {showNow && (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
            Now
          </span>
        )}
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900">
        {entry.narrative.headline}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
        {entry.narrative.likelyImpact}
      </p>

      <div className="mt-4">
        <MomentTranscriptContext
          previousTurn={context.previousTurn}
          focusTurn={context.focusTurn}
          nextTurn={context.nextTurn}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className={`${heatmapSoftCardClass} p-3`} style={heatmapSoftCardStyle}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            What happened next
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
            {entry.narrative.whatHappenedNext}
          </p>
        </div>
        <div className="rounded-xl border border-[#e7be8f] bg-[#eed8bb] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Why it mattered here
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#4b2d12]">
            {entry.narrative.whyItMattered}
          </p>
        </div>
      </div>

      {entry.narrative.tryInstead && (
        <div className="mt-4 rounded-xl border border-[#d7cce8] bg-[#ede7f4] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#4d3f68]">
            Next Best Move
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-[#4d3f68]">
            {entry.narrative.tryInstead}
          </p>
        </div>
      )}
    </div>
  );
}

export function EscalationTimeline({
  sessionId,
  events,
  turns,
  maxCeiling,
  sessionStartedAt,
  recordingUrl,
  onActiveKeyMomentChange,
}: EscalationTimelineProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPlaybackSecondRef = useRef<number | null>(null);
  const previousTriggeredMomentIndexRef = useRef<number | null | undefined>(undefined);
  const keyMomentEntriesRef = useRef<KeyMomentEntry[]>([]);

  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [playbackOverlayMomentIndex, setPlaybackOverlayMomentIndex] = useState<number | null>(null);
  const [selectedMomentIndex, setSelectedMomentIndex] = useState<number | null>(null);
  const [narrativeState, setNarrativeState] = useState<{
    requestKey: string;
    narratives: GeneratedTimelineNarrative[];
    debug: z.infer<typeof reviewDebugSchema>;
  } | null>(null);

  const startTime = new Date(sessionStartedAt).getTime();
  const lastTurnIndex = turns[turns.length - 1]?.turn_index ?? null;
  const requestKey = useMemo(
    () => JSON.stringify({
      sessionId,
      startedAt: sessionStartedAt,
      turnCount: turns.length,
      lastTurnIndex,
    }),
    [lastTurnIndex, sessionId, sessionStartedAt, turns.length]
  );

  const syncPlaybackOverlayMomentIndex = useEffectEvent((index: number | null) => {
    setPlaybackOverlayMomentIndex(index);
  });

  const syncPlaybackMomentFromTime = useEffectEvent((currentTime: number) => {
    const currentSecond = snapToSecond(currentTime);
    if (
      currentSecond !== null &&
      previousPlaybackSecondRef.current !== null &&
      currentSecond < previousPlaybackSecondRef.current
    ) {
      previousTriggeredMomentIndexRef.current = undefined;
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      syncPlaybackOverlayMomentIndex(null);
    }

    previousPlaybackSecondRef.current = currentSecond;

    const activeEntry = getKeyMomentAtTime(keyMomentEntriesRef.current, currentSecond);
    const nextIndex = activeEntry?.index ?? null;
    if (nextIndex === null || nextIndex === previousTriggeredMomentIndexRef.current) {
      return;
    }

    previousTriggeredMomentIndexRef.current = nextIndex;
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    syncPlaybackOverlayMomentIndex(nextIndex);
    overlayTimerRef.current = setTimeout(() => {
      syncPlaybackOverlayMomentIndex(null);
    }, PLAYBACK_CARD_DURATION_MS);
  });

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const width = Math.floor(container.clientWidth);
      const height = Math.floor(container.clientHeight);
      if (width < 1 || height < 1) return;

      setChartSize((previous) => (
        previous?.width === width && previous.height === height
          ? previous
          : { width, height }
      ));
    };

    updateSize();

    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!recordingUrl) return;

    const audio = new Audio(recordingUrl);
    audio.preload = "metadata";
    audioRef.current = audio;

    const syncTime = () => {
      const currentTime = audio.currentTime || 0;
      setPlaybackTime(currentTime);
      syncPlaybackMomentFromTime(currentTime);
    };

    const syncMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      syncPlaybackMomentFromTime(audio.currentTime || 0);
    };
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      syncTime();
      setIsPlaying(false);
    };
    const handleError = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("loadedmetadata", syncMetadata);
    audio.addEventListener("durationchange", syncMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.load();

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("loadedmetadata", syncMetadata);
      audio.removeEventListener("durationchange", syncMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      audio.removeAttribute("src");
      audio.load();

      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [recordingUrl]);

  const data: ChartPoint[] = events
    .filter((event) => event.escalation_after !== null)
    .map((event) => ({
      time: getRelativeTime(event.created_at, startTime),
      level: event.escalation_after!,
      type: event.event_type,
    }));

  if (data.length > 0 && data[0].time > 0) {
    const firstEvent = events.find((event) => event.event_type === "session_started");
    if (firstEvent) {
      data.unshift({
        time: 0,
        level: firstEvent.escalation_after ?? data[0].level,
        type: "session_started",
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadNarratives() {
      const cachedResult = timelineNarrativeResultCache.get(requestKey);
      if (cachedResult) {
        setNarrativeState({
          requestKey,
          ...cachedResult,
        });
        return;
      }

      let requestPromise = timelineNarrativeRequestCache.get(requestKey);
      if (!requestPromise) {
        requestPromise = (async () => {
          try {
            const res = await fetch(`/api/sessions/${sessionId}/timeline-feedback`, {
              cache: "no-store",
            });
            const payload = await res.json().catch(() => null);
            const parsed = reviewTimelineApiResponseSchema.safeParse(payload);

            if (parsed.success) {
              return {
                narratives: parsed.data.timeline?.narratives ?? [],
                debug: parsed.data.debug,
              };
            }

            return {
              narratives: [],
              debug: {
                ok: false,
                message: "Timeline analysis unavailable. The API returned an unexpected payload.",
                promptVersion: null,
                schemaVersion: null,
                model: null,
                reasoningEffort: null,
                fallbackUsed: false,
                failureClass: "schema" as const,
                validatorFailures: ["invalid_api_payload"],
              },
            };
          } catch {
            return {
              narratives: [],
              debug: {
                ok: false,
                message: "Timeline analysis unavailable. The request failed before a valid response was returned.",
                promptVersion: null,
                schemaVersion: null,
                model: null,
                reasoningEffort: null,
                fallbackUsed: false,
                failureClass: "schema" as const,
                validatorFailures: ["request_failed"],
              },
            };
          }
        })().finally(() => {
          timelineNarrativeRequestCache.delete(requestKey);
        });
        timelineNarrativeRequestCache.set(requestKey, requestPromise);
      }

      const result = await requestPromise;
      if (result.debug.ok || result.narratives.length > 0) {
        timelineNarrativeResultCache.set(requestKey, result);
      }
      if (cancelled) return;
      setNarrativeState({
        requestKey,
        ...result,
      });
    }

    void loadNarratives();

    return () => {
      cancelled = true;
    };
  }, [requestKey, sessionId]);

  const lastTurn = turns[turns.length - 1];
  const lastTurnTime = lastTurn ? getRelativeTime(lastTurn.started_at, startTime) : 0;
  const resolvedPlaybackTime = recordingUrl ? playbackTime : 0;
  const resolvedAudioDuration = recordingUrl ? audioDuration : 0;
  const playbackActive = recordingUrl ? isPlaying : false;
  const resolvedNarrativeState = narrativeState?.requestKey === requestKey ? narrativeState : null;
  const resolvedNarratives = useMemo(
    () => resolvedNarrativeState?.narratives ?? [],
    [resolvedNarrativeState]
  );
  const resolvedDebug = resolvedNarrativeState?.debug ?? null;
  const loadingNarratives = turns.some((turn) => turn.speaker === "trainee") && !resolvedNarrativeState;
  const turnPositionByTurnIndex = new Map(turns.map((turn, index) => [turn.turn_index, index]));
  const keyMomentEntries: KeyMomentEntry[] = resolvedNarratives
    .map((narrative, index) => {
      const turnPosition = turnPositionByTurnIndex.get(narrative.turnIndex);
      if (turnPosition === undefined) return null;

      const turn = turns[turnPosition];
      return {
        index,
        narrative,
        time: getTurnCueTime(turn, startTime),
      };
    })
    .filter((entry): entry is KeyMomentEntry => entry !== null)
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const timelineMaxTime = Math.max(
    data[data.length - 1]?.time ?? 0,
    keyMomentEntries[keyMomentEntries.length - 1]?.time ?? 0,
    lastTurnTime,
    resolvedAudioDuration,
    resolvedPlaybackTime,
    1
  );

  const playbackSecond = snapToSecond(resolvedPlaybackTime);
  const hoveredSecond = snapToSecond(hoveredTime);
  const markerTime = hoveredSecond !== null && !playbackActive
    ? hoveredSecond
    : playbackSecond;
  const markerPoint = getChartPointAtTime(data, markerTime);
  const hoveredKeyMomentIndex = getKeyMomentAtTime(keyMomentEntries, hoveredSecond)?.index ?? null;
  const resolvedSelectedMomentIndex = selectedMomentIndex !== null
    && keyMomentEntries.some((entry) => entry.index === selectedMomentIndex)
    ? selectedMomentIndex
    : keyMomentEntries[0]?.index ?? null;
  const displayedKeyMomentIndex = playbackOverlayMomentIndex
    ?? hoveredKeyMomentIndex
    ?? resolvedSelectedMomentIndex;
  const displayedKeyMomentEntry = displayedKeyMomentIndex !== null
    ? keyMomentEntries.find((entry) => entry.index === displayedKeyMomentIndex) ?? null
    : null;

  useEffect(() => {
    keyMomentEntriesRef.current = keyMomentEntries;
  }, [keyMomentEntries]);

  useEffect(() => {
    onActiveKeyMomentChange?.(displayedKeyMomentIndex);
  }, [displayedKeyMomentIndex, onActiveKeyMomentChange]);

  useEffect(() => {
    if (!playbackActive) {
      previousPlaybackSecondRef.current = null;
      previousTriggeredMomentIndexRef.current = undefined;
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      syncPlaybackOverlayMomentIndex(null);
    }
  }, [playbackActive]);

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    };
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-slate-400">
        No escalation data recorded
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200/90 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
      <section className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
              Conversation path
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
              Read the full path of the encounter, then use the analysis beneath it to unpack the moments that changed it.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
              {formatTime(resolvedPlaybackTime)} / {formatTime(timelineMaxTime)}
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!recordingUrl}
              onClick={() => {
                const audio = audioRef.current;
                if (!audio) return;

                if (!audio.paused) {
                  audio.pause();
                  return;
                }

                const duration = Number.isFinite(audio.duration) ? audio.duration : resolvedAudioDuration;
                if (duration > 0 && audio.currentTime >= duration - 0.25) {
                  audio.currentTime = 0;
                  setPlaybackTime(0);
                }

                void audio.play().catch(() => {
                  setIsPlaying(false);
                });
              }}
              className="gap-2"
              title={recordingUrl ? (playbackActive ? "Pause conversation playback" : "Play full conversation") : "Session audio unavailable"}
            >
              {playbackActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playbackActive ? "Pause" : "Play"}
            </Button>
          </div>
        </div>

        <div
          ref={chartContainerRef}
          className={cn(
            "relative h-64 w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-[#f8fafc] p-2 sm:h-80",
            recordingUrl && "cursor-pointer"
          )}
          style={{ minWidth: 1, minHeight: 1 }}
          onClick={(event) => {
            if (!recordingUrl || !chartSize) return;
            const audio = audioRef.current;
            if (!audio) return;

            const rect = event.currentTarget.getBoundingClientRect();
            const usableWidth = chartSize.width - CHART_MARGIN.left - CHART_MARGIN.right;
            if (usableWidth <= 0 || timelineMaxTime <= 0) return;

            const x = event.clientX - rect.left - CHART_MARGIN.left;
            const clampedX = Math.min(Math.max(x, 0), usableWidth);
            const seekTime = (clampedX / usableWidth) * timelineMaxTime;
            audio.currentTime = seekTime;
            setPlaybackTime(seekTime);
          }}
          onMouseMove={(event) => {
            if (!chartSize) return;

            const rect = event.currentTarget.getBoundingClientRect();
            const usableWidth = chartSize.width - CHART_MARGIN.left - CHART_MARGIN.right;
            if (usableWidth <= 0 || timelineMaxTime <= 0) return;

            const x = event.clientX - rect.left - CHART_MARGIN.left;
            const clampedX = Math.min(Math.max(x, 0), usableWidth);
            const ratio = clampedX / usableWidth;
            setHoveredTime(ratio * timelineMaxTime);
          }}
          onMouseLeave={() => setHoveredTime(null)}
        >
          {chartSize ? (
            <AreaChart
              width={chartSize.width}
              height={chartSize.height}
              data={data}
              margin={CHART_MARGIN}
            >
              <defs>
                <linearGradient id="escalationGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.18} />
                  <stop offset="40%" stopColor="#f59e0b" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.03} />
                </linearGradient>
              </defs>

              <ReferenceArea y1={0} y2={2.5} fill="#10b981" fillOpacity={0.03} />
              <ReferenceArea y1={2.5} y2={4.5} fill="#f59e0b" fillOpacity={0.03} />
              <ReferenceArea y1={4.5} y2={6.5} fill="#f97316" fillOpacity={0.03} />
              <ReferenceArea y1={6.5} y2={8.5} fill="#ef4444" fillOpacity={0.03} />
              <ReferenceArea y1={8.5} y2={10} fill="#991b1b" fillOpacity={0.03} />

              <CartesianGrid strokeDasharray="3 6" stroke="#e2e8f0" vertical={false} />

              <XAxis
                dataKey="time"
                type="number"
                domain={[0, timelineMaxTime]}
                tickFormatter={formatTime}
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "#e2e8f0" }}
              />
              <YAxis
                domain={[0, 10]}
                ticks={[1, 3, 5, 7, 9]}
                stroke="#94a3b8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={24}
              />

              {markerTime !== null && markerPoint && (
                <>
                  <ReferenceLine
                    x={markerTime}
                    stroke={hoveredSecond !== null && !playbackActive ? "#0f172a" : "#2563eb"}
                    strokeDasharray={hoveredSecond !== null && !playbackActive ? "4 4" : "6 3"}
                    strokeWidth={1.5}
                  />
                  <ReferenceDot
                    x={markerTime}
                    y={markerPoint.level}
                    ifOverflow="extendDomain"
                    shape={(props: { cx?: number; cy?: number }) => {
                      if (!props.cx || !props.cy) return <g />;
                      return (
                        <g>
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={10}
                            fill={hoveredSecond !== null && !playbackActive ? "#0f172a" : "#2563eb"}
                            opacity={0.14}
                          />
                          <circle
                            cx={props.cx}
                            cy={props.cy}
                            r={5}
                            fill={hoveredSecond !== null && !playbackActive ? "#0f172a" : "#2563eb"}
                            stroke="white"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    }}
                  />
                </>
              )}

              <ReferenceLine
                y={maxCeiling}
                stroke="#ef4444"
                strokeDasharray="6 4"
                strokeWidth={1.25}
                label={{
                  value: `Cap ${maxCeiling}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "#ef4444",
                  fontWeight: 600,
                }}
              />

              <Area
                type="stepAfter"
                dataKey="level"
                stroke="none"
                fill="url(#escalationGradient)"
              />

              <Area
                type="stepAfter"
                dataKey="level"
                stroke="#334155"
                strokeWidth={2.5}
                fill="none"
                dot={<CustomDot />}
                activeDot={{ r: 7, fill: "#334155", stroke: "white", strokeWidth: 3 }}
              />
            </AreaChart>
          ) : (
            <div className="h-full w-full animate-pulse rounded-xl bg-slate-100/70" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200/80 pt-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4">
              <line x1="0" y1="2" x2="16" y2="2" stroke="#334155" strokeWidth="2.5" />
            </svg>
            Conversation intensity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border-2 border-blue-500 bg-white" />
            Hover or playback marker
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full border-2 border-red-400 bg-white" />
            Change point
          </span>
        </div>
      </section>

      <section className="space-y-4 border-t border-slate-200/80 bg-[#f5f7fb] p-4 sm:p-5">
          <div className="max-w-2xl">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
              Timeline analysis
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
              Each numbered moment maps back to the path above, so the coaching stays tied to the same stretch of dialogue.
            </p>
          </div>

          {keyMomentEntries.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {keyMomentEntries.map((entry, tabIndex) => {
                const isSelected = entry.index === resolvedSelectedMomentIndex;
                const isPreviewed = entry.index === displayedKeyMomentIndex && !isSelected;

                return (
                  <button
                    key={`${entry.index}-${entry.time}`}
                    type="button"
                    onClick={() => setSelectedMomentIndex(entry.index)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-left text-[11px] transition-colors",
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : isPreviewed
                          ? "border-[#d7cce8] bg-[#ede7f4] text-[#4d3f68]"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                    )}
                  >
                    <span className="font-semibold">{tabIndex + 1}.</span>{" "}
                    {formatTime(entry.time)} • {(entry.narrative.lens?.trim() || (entry.narrative.positive ? "Helpful moment" : "Moment to revisit"))}
                  </button>
                );
              })}
            </div>
          )}

          <div className="min-h-[24rem]">
            {loadingNarratives && !displayedKeyMomentEntry ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.18)]">
                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
                  Timeline analysis
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
                  Analysing these moments and tailoring the coaching to this dialogue. This can take up to a minute.
                </p>
                <div className="mt-4 space-y-3">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-[88%] animate-pulse rounded bg-slate-100" />
                  <div className="h-24 w-full animate-pulse rounded-xl bg-slate-100" />
                </div>
              </div>
            ) : !loadingNarratives && resolvedDebug && !resolvedDebug.ok ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.12)]">
                <div className="inline-flex rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                  Timeline analysis unavailable
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-slate-700">
                  {resolvedDebug.message ?? "The timeline could not be generated for this session."}
                </p>
                {resolvedDebug.failureClass && (
                  <p className="mt-3 text-[12px] text-slate-700">
                    <span className="font-semibold text-slate-900">Failure class:</span> {resolvedDebug.failureClass}
                  </p>
                )}
                {resolvedDebug.validatorFailures.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {resolvedDebug.validatorFailures.map((issue) => (
                      <span key={issue} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] text-rose-700">
                        {issue}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : displayedKeyMomentEntry ? (
              <TimelineMomentCard
                entry={displayedKeyMomentEntry}
                turns={turns}
                showNow={playbackActive && displayedKeyMomentIndex === playbackOverlayMomentIndex}
              />
            ) : (
              <div className="flex min-h-[18rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/75">
                <p className="max-w-sm text-center text-[12px] text-slate-400">
                  Select a numbered moment above to keep one coaching detail panel in view.
                </p>
              </div>
            )}
          </div>
      </section>
    </div>
  );
}
