"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SimulationStateEvent } from "@/types/simulation";

interface EventLogProps {
  events: SimulationStateEvent[];
  sessionStartedAt: string;
}

const eventTypeLabels: Record<string, string> = {
  session_started: "Session Started",
  session_ended: "Session Ended",
  escalation_change: "Escalation",
  de_escalation_change: "De-escalation",
  ceiling_reached: "Ceiling Reached",
  trainee_exit: "Trainee Exit",
  classification_result: "Classification",
  prompt_update: "Prompt Updated",
  error: "Error",
};

const eventTypeColors: Record<string, string> = {
  escalation_change: "bg-red-100 text-red-800",
  de_escalation_change: "bg-green-100 text-green-800",
  ceiling_reached: "bg-red-200 text-red-900",
  trainee_exit: "bg-yellow-100 text-yellow-800",
  session_started: "bg-blue-100 text-blue-800",
  session_ended: "bg-blue-100 text-blue-800",
};

export function EventLog({ events, sessionStartedAt }: EventLogProps) {
  const startTime = new Date(sessionStartedAt).getTime();

  return (
    <ScrollArea className="h-full">
      <div className="space-y-2 p-4">
        {events.map((event) => {
          const elapsed = Math.round(
            (new Date(event.created_at).getTime() - startTime) / 1000
          );
          const m = Math.floor(elapsed / 60);
          const s = elapsed % 60;
          const timeStr = `${m}:${s.toString().padStart(2, "0")}`;

          return (
            <div
              key={event.id}
              className="flex items-start gap-3 rounded-md border p-3 text-sm"
            >
              <span className="text-xs tabular-nums text-muted-foreground shrink-0 pt-0.5 w-10">
                {timeStr}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className={eventTypeColors[event.event_type] || ""}
                  >
                    {eventTypeLabels[event.event_type] || event.event_type}
                  </Badge>
                  {event.escalation_before !== null && event.escalation_after !== null && (
                    <span className="text-xs text-muted-foreground">
                      {event.escalation_before} → {event.escalation_after}
                    </span>
                  )}
                </div>
                {event.payload && typeof event.payload === "object" && "classifier" in event.payload && (
                  <p className="text-xs text-muted-foreground">
                    {(event.payload as { classifier?: { reasoning?: string } }).classifier?.reasoning}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
