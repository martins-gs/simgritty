"use client";

import type { ScoreBreakdown } from "@/lib/engine/scoring";
import type { QualitativeLabel } from "@/types/simulation";
import { heatmapShellClass, heatmapShellStyle } from "@/lib/ui/insightTheme";
import { cn } from "@/lib/utils";

interface ScoreCardProps {
  score: ScoreBreakdown;
  preliminary?: boolean;
}

function getLabelColors(label: QualitativeLabel) {
  switch (label) {
    case "Strong":
      return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" };
    case "Developing":
      return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" };
    case "Needs practice":
      return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" };
  }
}

function getBarColor(ratio: number) {
  if (ratio >= 0.8) return "bg-emerald-500";
  if (ratio >= 0.6) return "bg-blue-500";
  if (ratio >= 0.4) return "bg-amber-500";
  return "bg-red-400";
}

function ScoreBar({
  label,
  value,
  weight,
  description,
}: {
  label: string;
  value: number;
  weight: number;
  description: string;
}) {
  const ratio = value / 100;
  const weightPct = Math.round(weight * 100);
  const notExercised = weightPct === 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-700">{label}</span>
        <span className="text-[12px] tabular-nums text-slate-900">
          <span className="font-bold">{notExercised ? "N/A" : value}</span>
          {!notExercised && <span className="text-slate-400 font-normal">/100</span>}
          <span className="ml-1.5 text-[10px] text-slate-400 font-normal">({weightPct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            notExercised ? "bg-slate-300" : getBarColor(ratio)
          )}
          style={{ width: `${notExercised ? 100 : ratio * 100}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-400 hidden sm:block">
        {notExercised ? "Not exercised in this session, so it did not affect the overall score." : description}
      </p>
    </div>
  );
}

export function ScoreCard({ score, preliminary }: ScoreCardProps) {
  const labelColors = getLabelColors(score.qualitativeLabel);

  return (
    <div className={`${heatmapShellClass} overflow-hidden`} style={heatmapShellStyle}>
      <div className="border-b border-slate-200/70 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Score Breakdown
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
              These numbers are a rough guide to the communication patterns in this session, not a final verdict.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[12px] font-semibold text-slate-700">
              Overall {score.overall}/100
            </span>
            <span className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-semibold",
              labelColors.border,
              labelColors.bg,
              labelColors.text
            )}>
              {score.qualitativeLabel}
            </span>
          </div>
        </div>
        {preliminary && (
          <p className="mt-3 text-[11px] font-medium text-[#9a5a12]">
            Short session: treat this breakdown as especially tentative. Extreme scores are softened until there is more evidence.
          </p>
        )}
      </div>

      {/* Score breakdown — single column on mobile */}
      <div className="grid gap-3 p-4 sm:gap-4 sm:p-5 sm:grid-cols-2">
        <ScoreBar
          label="Composure"
          value={score.composure}
          weight={score.weightsUsed.composure}
          description="Measures ability to remain calm, respectful, and non-defensive under pressure"
        />
        <ScoreBar
          label="De-escalation"
          value={score.deEscalation}
          weight={score.weightsUsed.de_escalation}
          description="Measures ability to reduce emotional intensity without making the interaction worse"
        />
        {score.clinicalTask != null && (
          <ScoreBar
            label="Clinical Task"
            value={score.clinicalTask}
            weight={score.weightsUsed.clinical_task}
            description="Measures ability to keep addressing the clinical problem during conflict"
          />
        )}
        <ScoreBar
          label="Support Seeking"
          value={score.supportSeeking}
          weight={score.weightsUsed.support_seeking}
          description="Measures judgment about when to continue alone and when to request support"
        />
      </div>
      <div className="border-t border-slate-200/70 px-4 py-2.5 sm:px-5">
        <p className="text-[11px] text-slate-400">
          Percentages in brackets show this scenario&apos;s weighting for each dimension.
        </p>
      </div>
    </div>
  );
}
