"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { SimulationStateEvent } from "@/types/simulation";
import { ESCALATION_LABELS } from "@/types/escalation";

interface EscalationTimelineProps {
  events: SimulationStateEvent[];
  maxCeiling: number;
  sessionStartedAt: string;
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

function getLevelColor(level: number): string {
  if (level <= 2) return "#10b981";
  if (level <= 4) return "#f59e0b";
  if (level <= 6) return "#f97316";
  if (level <= 8) return "#ef4444";
  return "#991b1b";
}

function getEventDotColor(type: string): string {
  if (type === "escalation_change") return "#ef4444";
  if (type === "de_escalation_change") return "#10b981";
  if (type === "ceiling_reached") return "#991b1b";
  if (type === "session_started" || type === "session_ended") return "#6366f1";
  return "#94a3b8";
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
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
    <div className="rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-sm max-w-xs">
      <div className="flex items-center justify-between gap-4 mb-2">
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

      <p className="text-[12px] font-semibold text-slate-800 mb-0.5">
        {ESCALATION_LABELS[data.level] ?? `Level ${data.level}`}
      </p>

      {data.technique && (
        <p className="text-[12px] text-slate-600 mt-1.5">
          <span className="font-medium">Technique:</span> {data.technique}
        </p>
      )}

      {data.effectiveness !== null && (
        <p className="text-[12px] mt-0.5">
          <span className="font-medium text-slate-600">Effectiveness:</span>{" "}
          <span
            className="font-bold"
            style={{
              color: data.effectiveness > 0.2 ? "#10b981" : data.effectiveness < -0.2 ? "#ef4444" : "#94a3b8",
            }}
          >
            {data.effectiveness > 0 ? "+" : ""}
            {data.effectiveness.toFixed(2)}
          </span>
        </p>
      )}

      {data.reasoning && (
        <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed italic">
          {data.reasoning}
        </p>
      )}

      {(data.trust !== null || data.listening !== null) && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex gap-4 text-[11px]">
          {data.trust !== null && (
            <span className="text-blue-500 font-medium">Trust: {data.trust}/10</span>
          )}
          {data.listening !== null && (
            <span className="text-purple-500 font-medium">Listening: {data.listening}/10</span>
          )}
        </div>
      )}
    </div>
  );
}

export function EscalationTimeline({
  events,
  maxCeiling,
  sessionStartedAt,
}: EscalationTimelineProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const startTime = new Date(sessionStartedAt).getTime();

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

  const data: ChartPoint[] = events
    .filter((e) => e.escalation_after !== null)
    .map((e) => {
      const classifierPayload = e.payload?.classifier as {
        technique?: string;
        effectiveness?: number;
        reasoning?: string;
      } | undefined;
      return {
        time: Math.round((new Date(e.created_at).getTime() - startTime) / 1000),
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

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[13px] text-slate-400">
        No escalation data recorded
      </div>
    );
  }

  const peakLevel = Math.max(...data.map((d) => d.level));
  const finalLevel = data[data.length - 1].level;
  const escalationEvents = data.filter((d) => d.type === "escalation_change").length;
  const deescalationEvents = data.filter((d) => d.type === "de_escalation_change").length;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
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
            {formatTime(data[data.length - 1].time)}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div
        ref={chartContainerRef}
        className="h-56 w-full sm:h-80"
        style={{ minWidth: 1, minHeight: 1 }}
      >
        {chartSize ? (
          <AreaChart
            width={chartSize.width}
            height={chartSize.height}
            data={data}
            margin={{ top: 8, right: 52, bottom: 6, left: 4 }}
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

            {/* Severity zone backgrounds */}
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

            {/* Ceiling line */}
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

            {/* Trust overlay */}
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

            {/* Escalation area */}
            <Area
              type="stepAfter"
              dataKey="level"
              stroke="none"
              fill="url(#escalationGradient)"
            />

            {/* Escalation line */}
            <Area
              type="stepAfter"
              dataKey="level"
              stroke="#334155"
              strokeWidth={2.5}
              fill="none"
              dot={<CustomDot />}
              activeDot={{ r: 8, fill: "#334155", stroke: "white", strokeWidth: 3 }}
            />

            {/* Zone labels on the right */}
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
      </div>

      {/* Legend */}
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
