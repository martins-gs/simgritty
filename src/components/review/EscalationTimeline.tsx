"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from "recharts";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeyMomentCard } from "@/components/review/KeyMoments";
import type { ScoreEvidence } from "@/lib/engine/scoring";
import type { SimulationStateEvent, TranscriptTurn } from "@/types/simulation";
import { ESCALATION_LABELS } from "@/types/escalation";

interface EscalationTimelineProps {
  events: SimulationStateEvent[];
  turns: TranscriptTurn[];
  keyMoments: ScoreEvidence[];
  maxCeiling: number;
  sessionStartedAt: string;
  recordingUrl?: string | null;
  onActiveKeyMomentChange?: (index: number | null) => void;
}

interface ChartPoint {
  time: number;
  level: number;
  trust: number | null;
  listening: number | null;
  type: string;
  reasoning: string | null;
  technique: string | null;
  effectiveness: number | null;
}

interface KeyMomentEntry {
  index: number;
  time: number;
}

const CHART_MARGIN = { top: 8, right: 52, bottom: 6, left: 4 };

function getLevelColor(level: number): string {
  if (level <= 2) return "#10b981";
  if (level <= 4) return "#f59e0b";
  if (level <= 6) return "#f97316";
  if (level <= 8) return "#ef4444";
  return "#991b1b";
}

function getEffectivenessColor(effectiveness: number): string {
  if (effectiveness > 0.2) return "#10b981";
  if (effectiveness < -0.2) return "#ef4444";
  return "#94a3b8";
}

function getEventDotColor(type: string): string {
  if (type === "escalation_change") return "#ef4444";
  if (type === "de_escalation_change") return "#10b981";
  if (type === "ceiling_reached") return "#991b1b";
  if (type === "session_started" || type === "session_ended") return "#6366f1";
  return "#94a3b8";
}

function getRelativeTime(timestamp: string, startTime: number) {
  return Math.max(0, (new Date(timestamp).getTime() - startTime) / 1000);
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

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].time <= time) {
      return entries[i];
    }
  }

  return null;
}


function formatTime(secs: number) {
  const wholeSeconds = Math.max(0, Math.floor(secs));
  const m = Math.floor(wholeSeconds / 60);
  const s = wholeSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CustomDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
  index?: number;
}) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload) return null;

  const color = getEventDotColor(payload.type);
  const isEscalation = payload.type === "escalation_change";
  const isDeescalation = payload.type === "de_escalation_change";
  const isCeiling = payload.type === "ceiling_reached";
  const isSessionBoundary = payload.type === "session_started" || payload.type === "session_ended";
  const size = isCeiling ? 7 : isEscalation || isDeescalation ? 5 : isSessionBoundary ? 4 : 3;

  return (
    <g>
      <circle cx={cx} cy={cy} r={size + 3} fill={color} opacity={0.15} />
      <circle cx={cx} cy={cy} r={size} fill="white" stroke={color} strokeWidth={2.5} />
      {(isEscalation || isCeiling) && (
        <path
          d={`M${cx} ${cy - 2} l-2.5 4 h5 z`}
          fill={color}
        />
      )}
      {isDeescalation && (
        <path
          d={`M${cx} ${cy + 2} l-2.5 -4 h5 z`}
          fill={color}
        />
      )}
    </g>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  const levelColor = getLevelColor(data.level);

  return (
    <div className="max-w-xs rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-[11px] font-medium text-slate-400">
          {formatTime(label ?? data.time)}
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: levelColor }}
        >
          Level {data.level}
        </span>
      </div>

      <p className="mb-0.5 text-[12px] font-semibold text-slate-800">
        {ESCALATION_LABELS[data.level] ?? `Level ${data.level}`}
      </p>

      {data.technique && (
        <p className="mt-1.5 text-[12px] text-slate-600">
          <span className="font-medium">Technique:</span> {data.technique}
        </p>
      )}

      {data.effectiveness !== null && (
        <p className="mt-0.5 text-[12px]">
          <span className="font-medium text-slate-600">Effectiveness:</span>{" "}
          <span
            className="font-bold"
            style={{ color: getEffectivenessColor(data.effectiveness) }}
          >
            {data.effectiveness > 0 ? "+" : ""}
            {data.effectiveness.toFixed(2)}
          </span>
        </p>
      )}

      {data.reasoning && (
        <p className="mt-1.5 text-[12px] italic leading-relaxed text-slate-500">
          {data.reasoning}
        </p>
      )}

      {(data.trust !== null || data.listening !== null) && (
        <div className="mt-2 flex gap-4 border-t border-slate-100 pt-2 text-[11px]">
          {data.trust !== null && (
            <span className="font-medium text-blue-500">Trust: {data.trust}/10</span>
          )}
          {data.listening !== null && (
            <span className="font-medium text-purple-500">Listening: {data.listening}/10</span>
          )}
        </div>
      )}
    </div>
  );
}

export function EscalationTimeline({
  events,
  turns,
  keyMoments,
  maxCeiling,
  sessionStartedAt,
  recordingUrl,
  onActiveKeyMomentChange,
}: EscalationTimelineProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevOverlayIndexRef = useRef<number | null | undefined>(undefined);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [overlayMomentIndex, setOverlayMomentIndex] = useState<number | null>(null);
  const startTime = new Date(sessionStartedAt).getTime();
  const syncOverlayMomentIndex = useEffectEvent((index: number | null) => {
    setOverlayMomentIndex(index);
  });

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const width = Math.floor(container.clientWidth);
      const height = Math.floor(container.clientHeight);
      if (width < 1 || height < 1) return;

      setChartSize((prev) => (
        prev?.width === width && prev.height === height
          ? prev
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
      setPlaybackTime(audio.currentTime || 0);
    };

    const syncMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handlePlay = () => setIsPlaying(true);
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
    .filter((e) => e.escalation_after !== null)
    .map((e) => {
      const classifierPayload = e.payload?.classifier as {
        technique?: string;
        effectiveness?: number;
        reasoning?: string;
      } | undefined;
      return {
        time: getRelativeTime(e.created_at, startTime),
        level: e.escalation_after!,
        trust: e.trust_after,
        listening: e.listening_after,
        type: e.event_type,
        reasoning: classifierPayload?.reasoning ?? null,
        technique: classifierPayload?.technique ?? null,
        effectiveness: classifierPayload?.effectiveness ?? null,
      };
    });

  if (data.length > 0 && data[0].time > 0) {
    const firstEvent = events.find((e) => e.event_type === "session_started");
    if (firstEvent) {
      data.unshift({
        time: 0,
        level: firstEvent.escalation_after ?? data[0].level,
        trust: firstEvent.trust_after,
        listening: firstEvent.listening_after,
        type: "session_started",
        reasoning: null,
        technique: null,
        effectiveness: null,
      });
    }
  }

  const keyMomentEntries: KeyMomentEntry[] = keyMoments
    .map((moment, index) => {
      const turn = turns.find((candidate) => candidate.turn_index === moment.turnIndex);
      if (!turn) return null;

      return {
        index,
        time: getRelativeTime(turn.started_at, startTime),
      };
    })
    .filter((entry): entry is KeyMomentEntry => entry !== null)
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const lastTurn = turns[turns.length - 1];
  const lastTurnTime = lastTurn ? getRelativeTime(lastTurn.started_at, startTime) : 0;
  const resolvedPlaybackTime = recordingUrl ? playbackTime : 0;
  const resolvedAudioDuration = recordingUrl ? audioDuration : 0;
  const playbackActive = recordingUrl ? isPlaying : false;
  const timelineMaxTime = Math.max(
    data[data.length - 1]?.time ?? 0,
    keyMomentEntries[keyMomentEntries.length - 1]?.time ?? 0,
    lastTurnTime,
    resolvedAudioDuration,
    resolvedPlaybackTime,
    1
  );
  const peakLevel = Math.max(...data.map((d) => d.level));
  const finalLevel = data[data.length - 1].level;
  const escalationEvents = data.filter((d) => d.type === "escalation_change").length;
  const deescalationEvents = data.filter((d) => d.type === "de_escalation_change").length;
  const playbackSecond = snapToSecond(resolvedPlaybackTime);
  const hoveredSecond = snapToSecond(hoveredTime);
  const markerTime = !playbackActive && hoveredSecond !== null
    ? hoveredSecond
    : playbackSecond;
  const markerPoint = getChartPointAtTime(data, markerTime);
  const activeKeyMoment = getKeyMomentAtTime(keyMomentEntries, markerTime);

  useEffect(() => {
    onActiveKeyMomentChange?.(activeKeyMoment?.index ?? null);
  }, [activeKeyMoment?.index, onActiveKeyMomentChange]);

  // Show overlay card when the active key moment changes during playback.
  // Uses the same `activeKeyMoment` that drives sidebar highlighting, so the
  // overlay stays in sync with what the user sees in the Key Moments panel.
  const activeKeyMomentIndex = activeKeyMoment?.index ?? null;

  useEffect(() => {
    if (!playbackActive) {
      prevOverlayIndexRef.current = undefined;
      syncOverlayMomentIndex(null);
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      return;
    }

    if (activeKeyMomentIndex === null || activeKeyMomentIndex === prevOverlayIndexRef.current) return;
    prevOverlayIndexRef.current = activeKeyMomentIndex;

    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    syncOverlayMomentIndex(activeKeyMomentIndex);
    overlayTimerRef.current = setTimeout(() => syncOverlayMomentIndex(null), 15_000);
  }, [playbackActive, activeKeyMomentIndex]);

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
            <span className="text-slate-400">Peak </span>
            <span className="font-bold" style={{ color: getLevelColor(peakLevel) }}>
              {peakLevel}
            </span>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
            <span className="text-slate-400">Final </span>
            <span className="font-bold" style={{ color: getLevelColor(finalLevel) }}>
              {finalLevel}
            </span>
          </div>
          {escalationEvents > 0 && (
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-1.5 text-[11px]">
              <span className="font-bold text-red-600">{escalationEvents}</span>
              <span className="text-red-400"> escalation{escalationEvents !== 1 ? "s" : ""}</span>
            </div>
          )}
          {deescalationEvents > 0 && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px]">
              <span className="font-bold text-emerald-600">{deescalationEvents}</span>
              <span className="text-emerald-400"> de-escalation{deescalationEvents !== 1 ? "s" : ""}</span>
            </div>
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px]">
            <span className="text-slate-400">Duration </span>
            <span className="font-bold text-slate-700">
              {formatTime(timelineMaxTime)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600">
            {formatTime(resolvedPlaybackTime)} / {formatTime(timelineMaxTime)}
          </div>
          <Button
            type="button"
            size="sm"
            variant="default"
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
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500">
            1s playhead
          </div>
        </div>
      </div>

      <div
        ref={chartContainerRef}
        className={`relative h-56 w-full sm:h-80${recordingUrl ? " cursor-pointer" : ""}`}
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
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="40%" stopColor="#f59e0b" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="trustGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>

            <ReferenceArea y1={0} y2={2.5} fill="#10b981" fillOpacity={0.04} />
            <ReferenceArea y1={2.5} y2={4.5} fill="#f59e0b" fillOpacity={0.04} />
            <ReferenceArea y1={4.5} y2={6.5} fill="#f97316" fillOpacity={0.04} />
            <ReferenceArea y1={6.5} y2={8.5} fill="#ef4444" fillOpacity={0.04} />
            <ReferenceArea y1={8.5} y2={10} fill="#991b1b" fillOpacity={0.04} />

            <CartesianGrid
              strokeDasharray="3 6"
              stroke="#e2e8f0"
              vertical={false}
            />

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
              ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={28}
              tickFormatter={(value) => `${value}`}
            />

            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: "#cbd5e1", strokeDasharray: "4 4" }}
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
                          opacity={0.16}
                          className="animate-pulse"
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
              strokeWidth={1.5}
              label={{
                value: `Scenario cap ${maxCeiling}`,
                position: "right",
                fontSize: 10,
                fill: "#ef4444",
                fontWeight: 600,
              }}
            />

            <Area
              type="monotone"
              dataKey="trust"
              stroke="#3b82f6"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="url(#trustGradient)"
              dot={false}
              connectNulls
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
              activeDot={{ r: 8, fill: "#334155", stroke: "white", strokeWidth: 3 }}
            />

            <ReferenceLine
              y={1.5}
              stroke="none"
              label={{
                value: "Settled",
                position: "right",
                fontSize: 9,
                fill: "#10b981",
                fontWeight: 500,
              }}
            />
            <ReferenceLine
              y={3.5}
              stroke="none"
              label={{
                value: "Guarded",
                position: "right",
                fontSize: 9,
                fill: "#f59e0b",
                fontWeight: 500,
              }}
            />
            <ReferenceLine
              y={5.5}
              stroke="none"
              label={{
                value: "Hostile",
                position: "right",
                fontSize: 9,
                fill: "#f97316",
                fontWeight: 500,
              }}
            />
            <ReferenceLine
              y={7.5}
              stroke="none"
              label={{
                value: "Abusive",
                position: "right",
                fontSize: 9,
                fill: "#ef4444",
                fontWeight: 500,
              }}
            />
            <ReferenceLine
              y={9.5}
              stroke="none"
              label={{
                value: "Critical",
                position: "right",
                fontSize: 9,
                fill: "#991b1b",
                fontWeight: 500,
              }}
            />
          </AreaChart>
        ) : (
          <div className="h-full w-full animate-pulse rounded-xl bg-slate-100/70" />
        )}

        {overlayMomentIndex !== null && (() => {
          const moment = keyMoments[overlayMomentIndex];
          if (!moment) return null;
          const turn = turns.find((t) => t.turn_index === moment.turnIndex);
          return (
            <div className="pointer-events-none absolute bottom-3 left-9 z-10 w-72 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5">
              <KeyMomentCard moment={moment} turn={turn} isActive />
            </div>
          );
        })()}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#334155" strokeWidth="2.5" /></svg>
          Patient/relative state
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Trust
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-blue-500 bg-white" />
          Playback marker
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-red-400 bg-white" />
          Escalation event
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full border-2 border-emerald-400 bg-white" />
          De-escalation event
        </span>
      </div>
    </div>
  );
}
