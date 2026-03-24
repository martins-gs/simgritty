"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { SimulationStateEvent } from "@/types/simulation";

interface EscalationTimelineProps {
  events: SimulationStateEvent[];
  maxCeiling: number;
  sessionStartedAt: string;
}

export function EscalationTimeline({
  events,
  maxCeiling,
  sessionStartedAt,
}: EscalationTimelineProps) {
  const startTime = new Date(sessionStartedAt).getTime();

  const data = events
    .filter((e) => e.escalation_after !== null)
    .map((e) => ({
      time: Math.round((new Date(e.created_at).getTime() - startTime) / 1000),
      level: e.escalation_after,
      type: e.event_type,
    }));

  // Add starting point if not present
  if (data.length > 0 && data[0].time > 0) {
    const firstEvent = events.find((e) => e.event_type === "session_started");
    if (firstEvent) {
      data.unshift({
        time: 0,
        level: firstEvent.escalation_after ?? data[0].level,
        type: "session_started",
      });
    }
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="time"
            tickFormatter={formatTime}
            className="text-xs"
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            domain={[0, 10]}
            ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
            className="text-xs"
            stroke="hsl(var(--muted-foreground))"
          />
          <Tooltip
            formatter={(value) => [`Level ${value}`, "Escalation"]}
            labelFormatter={(label) => `Time: ${formatTime(Number(label))}`}
          />
          <ReferenceLine
            y={maxCeiling}
            stroke="hsl(var(--destructive))"
            strokeDasharray="5 5"
            label={{ value: "Ceiling", position: "right", fontSize: 10 }}
          />
          <Line
            type="stepAfter"
            dataKey="level"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
