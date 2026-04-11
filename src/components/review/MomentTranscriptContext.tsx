"use client";

import { cn } from "@/lib/utils";
import type { TranscriptTurn } from "@/types/simulation";

interface MomentTranscriptContextProps {
  previousTurn: TranscriptTurn | null;
  focusTurn: TranscriptTurn | null;
  nextTurn: TranscriptTurn | null;
}

function getSpeakerLabel(speaker: TranscriptTurn["speaker"]): string {
  if (speaker === "trainee") return "You";
  if (speaker === "system") return "AI clinician";
  return "Patient/relative";
}

function ContextLine({
  label,
  turn,
  emphasis = false,
}: {
  label: string;
  turn: TranscriptTurn | null;
  emphasis?: boolean;
}) {
  if (!turn?.content) return null;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2",
        emphasis
          ? "border-slate-300 bg-white shadow-sm"
          : "border-slate-200 bg-slate-50/80"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label} • {getSpeakerLabel(turn.speaker)}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-700">
        &ldquo;{turn.content}&rdquo;
      </p>
    </div>
  );
}

export function MomentTranscriptContext({
  previousTurn,
  focusTurn,
  nextTurn,
}: MomentTranscriptContextProps) {
  if (!previousTurn && !focusTurn && !nextTurn) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        Surrounding transcript
      </p>
      <div className="space-y-2">
        <ContextLine label="Before" turn={previousTurn} />
        <ContextLine label="Moment" turn={focusTurn} emphasis />
        <ContextLine label="After" turn={nextTurn} />
      </div>
    </div>
  );
}

