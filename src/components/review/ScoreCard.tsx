"use client";

import type { ScoreBreakdown } from "@/lib/engine/scoring";
import { cn } from "@/lib/utils";

interface ScoreCardProps {
  score: ScoreBreakdown;
}

function getGradeColor(grade: string) {
  if (grade.startsWith("A")) return { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", ring: "ring-emerald-500/20" };
  if (grade === "B") return { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", ring: "ring-blue-500/20" };
  if (grade === "C") return { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", ring: "ring-amber-500/20" };
  if (grade === "D") return { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", ring: "ring-orange-500/20" };
  return { bg: "bg-red-50", text: "text-red-700", border: "border-red-200", ring: "ring-red-500/20" };
}

function getBarColor(ratio: number) {
  if (ratio >= 0.75) return "bg-emerald-500";
  if (ratio >= 0.5) return "bg-blue-500";
  if (ratio >= 0.3) return "bg-amber-500";
  return "bg-red-400";
}

function ScoreBar({ label, value, max, description }: { label: string; value: number; max: number; description: string }) {
  const ratio = max > 0 ? value / max : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-700">{label}</span>
        <span className="text-[12px] font-bold tabular-nums text-slate-900">{value}<span className="text-slate-400 font-normal">/{max}</span></span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all duration-500", getBarColor(ratio))}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className="text-[10px] text-slate-400">{description}</p>
    </div>
  );
}

export function ScoreCard({ score }: ScoreCardProps) {
  const gradeColors = getGradeColor(score.grade);
  const overallRatio = score.overall / 100;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Top section — overall score + grade */}
      <div className="flex items-stretch border-b border-slate-100">
        {/* Grade badge */}
        <div className={cn(
          "flex flex-col items-center justify-center px-6 py-5 border-r border-slate-100",
          gradeColors.bg
        )}>
          <span className={cn("text-4xl font-black leading-none tracking-tight", gradeColors.text)}>
            {score.grade}
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Grade
          </span>
        </div>

        {/* Overall score + ring */}
        <div className="flex flex-1 items-center gap-5 px-5 py-4">
          <div className="relative h-16 w-16 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle
                cx="18" cy="18" r="15.5"
                fill="none" stroke="#e2e8f0" strokeWidth="3"
              />
              <circle
                cx="18" cy="18" r="15.5"
                fill="none"
                stroke={overallRatio >= 0.7 ? "#10b981" : overallRatio >= 0.5 ? "#3b82f6" : overallRatio >= 0.3 ? "#f59e0b" : "#ef4444"}
                strokeWidth="3"
                strokeLinecap="round"
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
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{score.summary}</p>
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <ScoreBar
          label="De-escalation"
          value={score.deescalation}
          max={40}
          description="How effectively you reduced the escalation level"
        />
        <ScoreBar
          label="Speed"
          value={score.speed}
          max={25}
          description="How quickly you achieved de-escalation"
        />
        <ScoreBar
          label="Independence"
          value={score.independence}
          max={25}
          description="Handling the situation without AI clinician help"
        />
        <ScoreBar
          label="Stability"
          value={score.stability}
          max={10}
          description="Avoiding wild swings and re-escalation"
        />
      </div>
    </div>
  );
}
