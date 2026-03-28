"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import type { TranscriptTurn, ClassifierResult } from "@/types/simulation";
import type { EscalationState } from "@/types/escalation";
import { ESCALATION_LABELS } from "@/types/escalation";

interface TranscriptViewerProps {
  turns: TranscriptTurn[];
  onTurnSelect?: (turnId: string) => void;
  selectedTurnId?: string | null;
}

function getSpeakerLabel(speaker: string): string {
  if (speaker === "trainee") return "Trainee";
  if (speaker === "system") return "AI Clinician";
  return "Patient";
}

function getSpeakerVariant(speaker: string): "default" | "secondary" | "outline" {
  if (speaker === "trainee") return "default";
  if (speaker === "system") return "outline";
  return "secondary";
}

function EscalationImpact({
  levelBefore,
  levelAfter,
}: {
  levelBefore: number;
  levelAfter: number;
}) {
  const delta = levelAfter - levelBefore;

  const isUp = delta > 0;
  const isDown = delta < 0;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums shrink-0",
        isUp && "bg-red-50 text-red-600",
        isDown && "bg-emerald-50 text-emerald-600",
        !isUp && !isDown && "bg-slate-50 text-slate-400"
      )}
      title={`${ESCALATION_LABELS[levelAfter] ?? `Level ${levelAfter}`} (${delta > 0 ? "+" : ""}${delta})`}
    >
      {isUp && <ArrowUp className="h-3 w-3" />}
      {isDown && <ArrowDown className="h-3 w-3" />}
      {!isUp && !isDown && <Minus className="h-3 w-3" />}
      <span>{levelAfter}</span>
    </div>
  );
}

export function TranscriptViewer({ turns, onTurnSelect, selectedTurnId }: TranscriptViewerProps) {
  // Build a map of each turn's "before" level by tracking state across turns.
  // Only trainee and system (AI clinician) turns update the tracked level because
  // patient turns never change the score and their state_after may be stale due
  // to async classification timing (the patient response can arrive before the
  // preceding trainee classification completes).
  const levelBeforeMap = new Map<string, number>();
  let lastKnownLevel = 3; // default initial level

  for (const turn of turns) {
    const stateAfter = turn.state_after as EscalationState | null;
    // The "before" for this turn is the last known level
    levelBeforeMap.set(turn.id, lastKnownLevel);
    // Update last known level only from scoring turns (trainee / system)
    if (stateAfter && (turn.speaker === "trainee" || turn.speaker === "system")) {
      lastKnownLevel = stateAfter.level;
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4">
        {turns.map((turn) => {
          const classifier = turn.classifier_result as ClassifierResult | null;
          const stateAfter = turn.state_after as EscalationState | null;
          const showImpact =
            (turn.speaker === "trainee" || turn.speaker === "system") &&
            stateAfter !== null;
          const levelBefore = levelBeforeMap.get(turn.id) ?? 3;

          return (
            <div
              key={turn.id}
              className={cn(
                "rounded-lg border p-3 transition-colors cursor-pointer hover:bg-accent/50",
                selectedTurnId === turn.id && "border-primary bg-accent/30"
              )}
              onClick={() => onTurnSelect?.(turn.id)}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={getSpeakerVariant(turn.speaker)}
                    className={cn(
                      "text-[10px]",
                      turn.speaker === "system" && "border-indigo-300 text-indigo-700 bg-indigo-50"
                    )}
                  >
                    {getSpeakerLabel(turn.speaker)}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {new Date(turn.started_at).toLocaleTimeString()}
                  </span>
                </div>
                {showImpact && (
                  <EscalationImpact
                    levelBefore={levelBefore}
                    levelAfter={stateAfter!.level}
                  />
                )}
              </div>
              <p className="text-sm">{turn.content}</p>
              {classifier && (turn.speaker === "trainee" || turn.speaker === "system") && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      classifier.effectiveness > 0.3
                        ? "border-green-500 text-green-700"
                        : classifier.effectiveness < -0.3
                        ? "border-red-500 text-red-700"
                        : "border-yellow-500 text-yellow-700"
                    )}
                  >
                    {classifier.technique} ({classifier.effectiveness > 0 ? "+" : ""}
                    {classifier.effectiveness.toFixed(1)})
                  </Badge>
                  {classifier.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
