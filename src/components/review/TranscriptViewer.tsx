"use client";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { AudioPlayButton } from "@/components/review/AudioPlayButton";
import type { TranscriptTurn, ClinicianAudioPayload } from "@/types/simulation";
import { ESCALATION_LABELS } from "@/types/escalation";

interface TranscriptViewerProps {
  turns: TranscriptTurn[];
  onTurnSelect?: (turnId: string) => void;
  selectedTurnId?: string | null;
  clinicianAudioByTurnIndex?: Map<number, ClinicianAudioPayload>;
  /** Signed URL for the session's full audio recording */
  sessionRecordingUrl?: string | null;
  /** ISO timestamp of when the session started (used to calculate seek offsets) */
  sessionStartedAt?: string | null;
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

export function TranscriptViewer({
  turns,
  onTurnSelect,
  selectedTurnId,
  clinicianAudioByTurnIndex,
  sessionRecordingUrl,
  sessionStartedAt,
}: TranscriptViewerProps) {
  const sessionStartMs = sessionStartedAt
    ? new Date(sessionStartedAt).getTime()
    : null;
  // Build a map of each turn's "before" level by tracking state across turns.
  // Only trainee and system (AI clinician) turns update the tracked level because
  // patient turns never change the score and their state_after may be stale due
  // to async classification timing (the patient response can arrive before the
  // preceding trainee classification completes).
  const levelBeforeMap = new Map<string, number>();
  let lastKnownLevel = 3; // default initial level

  for (const turn of turns) {
    const stateAfter = turn.state_after;
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
          const classifier = turn.classifier_result;
          const stateAfter = turn.state_after;
          const clinicianAudio = turn.speaker === "system"
            ? clinicianAudioByTurnIndex?.get(turn.turn_index)
            : undefined;
          const showImpact =
            (turn.speaker === "trainee" || turn.speaker === "system") &&
            stateAfter !== null;
          const levelBefore = levelBeforeMap.get(turn.id) ?? 3;

          // Audio playback offset calculation.
          //
          // started_at on transcript turns ≈ when the transcript event was
          // *received*, which is close to speech END (not start).
          //
          // For TRAINEE turns the previous turn is an AI turn whose
          // started_at ≈ AI speech end ≈ trainee speech start. Works well.
          //
          // For AI/PATIENT turns the previous turn is a trainee turn whose
          // started_at arrives at roughly the same time as (or slightly
          // after) the AI already begins speaking. So we need to seek a
          // few seconds earlier to catch the AI response from the start.
          const canPlayAudio =
            sessionRecordingUrl &&
            sessionStartMs &&
            (turn.speaker === "trainee" || turn.speaker === "ai");

          let audioStartOffset = 0;
          let audioEndOffset = 30;
          if (canPlayAudio) {
            const turnIdx = turns.indexOf(turn);
            const prevTurn = turnIdx > 0 ? turns[turnIdx - 1] : null;
            const thisEndMs = new Date(turn.started_at).getTime();

            if (prevTurn) {
              const prevEndSec =
                (new Date(prevTurn.started_at).getTime() - sessionStartMs) / 1000;

              if (turn.speaker === "ai") {
                // AI speech starts roughly when the trainee stops speaking,
                // which is a few seconds BEFORE the trainee transcript
                // arrives. Seek earlier to capture the full AI response.
                const AI_SEEK_BUFFER_S = 3;
                audioStartOffset = Math.max(0, prevEndSec - AI_SEEK_BUFFER_S);
              } else {
                // Trainee: previous AI turn's end ≈ trainee speech start
                audioStartOffset = Math.max(0, prevEndSec);
              }
            }

            // End: this turn's started_at (≈ this turn's speech end)
            audioEndOffset = (thisEndMs - sessionStartMs) / 1000;

            // Safety: ensure end > start, cap at +30s if something looks wrong
            if (audioEndOffset <= audioStartOffset) {
              audioEndOffset = audioStartOffset + 30;
            }
          }

          return (
            <div
              key={turn.id}
              role="button"
              tabIndex={0}
              aria-pressed={selectedTurnId === turn.id}
              className={cn(
                "cursor-pointer touch-manipulation rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                selectedTurnId === turn.id && "border-primary bg-accent/30"
              )}
              onClick={() => onTurnSelect?.(turn.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onTurnSelect?.(turn.id);
                }
              }}
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
                  {canPlayAudio && (
                    <AudioPlayButton
                      audioUrl={sessionRecordingUrl!}
                      startOffset={audioStartOffset}
                      endOffset={audioEndOffset}
                    />
                  )}
                </div>
                {showImpact && (
                  <EscalationImpact
                    levelBefore={levelBefore}
                    levelAfter={stateAfter!.level}
                  />
                )}
              </div>
              <p className="text-sm">{turn.content}</p>
              {clinicianAudio && (
                <div className="mt-2 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        clinicianAudio.path === "tts"
                          ? "border-amber-500 text-amber-700"
                          : clinicianAudio.realtime_outcome === "partial"
                            ? "border-yellow-500 text-yellow-700"
                            : "border-emerald-500 text-emerald-700"
                      )}
                    >
                      {clinicianAudio.path === "tts"
                        ? "TTS fallback"
                        : clinicianAudio.realtime_outcome === "partial"
                          ? "Realtime partial"
                          : "Realtime"}
                    </Badge>
                    {clinicianAudio.elapsed_ms !== null && (
                      <Badge variant="outline" className="text-[10px]">
                        {(clinicianAudio.elapsed_ms / 1000).toFixed(1)}s
                      </Badge>
                    )}
                  </div>
                  {(clinicianAudio.fallback_reason || clinicianAudio.renderer_error) && (
                    <p className="text-[11px] text-muted-foreground">
                      {clinicianAudio.fallback_reason || clinicianAudio.renderer_error}
                    </p>
                  )}
                </div>
              )}
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
