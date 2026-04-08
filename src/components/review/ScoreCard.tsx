"use client";

import type { ScoreBreakdown } from "@/lib/engine/scoring";
import type { QualitativeLabel } from "@/types/simulation";
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

function getRingColor(ratio: number) {
  if (ratio >= 0.8) return "#10b981";
  if (ratio >= 0.6) return "#3b82f6";
  if (ratio >= 0.4) return "#f59e0b";
  return "#ef4444";
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
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-700">{label}</span>
        <span className="text-[12px] tabular-nums text-slate-900">
          <span className="font-bold">{value}</span>
          <span className="text-slate-400 font-normal">/100</span>
          <span className="ml-1.5 text-[10px] text-slate-400 font-normal">({weightPct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all duration-500", getBarColor(ratio))}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-400 hidden sm:block">{description}</p>
    </div>
  );
}

export function ScoreCard({ score, preliminary }: ScoreCardProps) {
  const labelColors = getLabelColors(score.qualitativeLabel);
  const overallRatio = score.overall / 100;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Top section — stacks on mobile, side-by-side on sm+ */}
      <div className="flex flex-col sm:flex-row sm:items-stretch border-b border-slate-100">
        {/* Qualitative label + overall score — combined row on mobile */}
        <div className={cn(
          "flex items-center gap-4 px-4 py-4 sm:flex-col sm:justify-center sm:px-6 sm:py-5 sm:border-r border-b sm:border-b-0 border-slate-100",
          labelColors.bg
        )}>
          <span className={cn("text-lg font-bold leading-tight", labelColors.text)}>
            {score.qualitativeLabel}
          </span>
          {/* Ring visible inline on mobile */}
          <div className="relative h-12 w-12 shrink-0 sm:hidden">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={getRingColor(overallRatio)}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${overallRatio * 97.4} 97.4`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[13px] font-bold tabular-nums text-slate-900">{score.overall}</span>
            </div>
          </div>
        </div>

        {/* Desktop score ring + summary */}
        <div className="hidden sm:flex flex-1 items-center gap-5 px-5 py-4">
          <div className="relative h-16 w-16 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e2e8f0" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={getRingColor(overallRatio)}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${overallRatio * 97.4} 97.4`}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[15px] font-bold tabular-nums text-slate-900">{score.overall}</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">Performance Score</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{score.summary}</p>
            {preliminary && (
              <p className="mt-1 text-[10px] text-amber-600 font-medium">
                Short session — scores are preliminary.
              </p>
            )}
          </div>
        </div>

        {/* Mobile summary text */}
        <div className="sm:hidden px-4 py-3">
          <p className="text-[13px] leading-relaxed text-slate-500">{score.summary}</p>
          {preliminary && (
            <p className="mt-1 text-[10px] text-amber-600 font-medium">
              Short session — scores are preliminary.
            </p>
          )}
        </div>
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
      <div className="border-t border-slate-100 px-4 py-2.5 sm:px-5">
        <p className="text-[11px] text-slate-400">
          Percentages in brackets show this scenario&apos;s weighting for each dimension.
        </p>
      </div>
    </div>
  );
}
