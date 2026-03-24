"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TranscriptTurn, ClassifierResult } from "@/types/simulation";

interface TranscriptViewerProps {
  turns: TranscriptTurn[];
  onTurnSelect?: (turnId: string) => void;
  selectedTurnId?: string | null;
}

export function TranscriptViewer({ turns, onTurnSelect, selectedTurnId }: TranscriptViewerProps) {
  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-4">
        {turns.map((turn) => {
          const classifier = turn.classifier_result as ClassifierResult | null;
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
                <Badge
                  variant={turn.speaker === "trainee" ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {turn.speaker === "trainee" ? "Trainee" : turn.speaker === "ai" ? "Patient" : "System"}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {new Date(turn.started_at).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm">{turn.content}</p>
              {classifier && turn.speaker === "trainee" && (
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
