"use client";

import { cn } from "@/lib/utils";
import { ESCALATION_LABELS } from "@/types/escalation";

interface EscalationMeterProps {
  level: number;
  maxCeiling: number;
}

function getLevelColor(level: number): string {
  if (level <= 2) return "from-emerald-400 to-teal-500";
  if (level <= 4) return "from-amber-300 to-orange-400";
  if (level <= 6) return "from-orange-400 to-red-500";
  if (level <= 8) return "from-rose-400 to-red-600";
  return "from-red-600 to-red-950";
}

export function EscalationMeter({ level, maxCeiling }: EscalationMeterProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-slate-500">
            Escalation
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-3xl font-semibold tracking-tight text-slate-950">
              {level}
            </span>
            <span className="pb-1 text-sm text-slate-400">/10</span>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/75 px-3 py-2 text-right shadow-sm">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">
            Current State
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {ESCALATION_LABELS[level]}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-10 gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const isActive = n <= level;
          const isAboveCeiling = n > maxCeiling;
          return (
            <div
              key={n}
              className={cn(
                "h-16 rounded-2xl border transition-all duration-300",
                isAboveCeiling
                  ? "border-slate-200/70 bg-slate-100/70"
                  : isActive
                  ? `border-transparent bg-gradient-to-t ${getLevelColor(n)} shadow-[0_12px_32px_-18px_rgba(15,23,42,0.7)]`
                  : "border-slate-200 bg-white/80"
              )}
              title={`${n}: ${ESCALATION_LABELS[n]}`}
            >
              <div className="flex h-full items-end justify-center pb-2 text-[10px] font-medium text-slate-600">
                {n}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>De-escalated</span>
        <span>Ceiling {maxCeiling}/10</span>
        <span>Crisis</span>
      </div>
    </div>
  );
}
