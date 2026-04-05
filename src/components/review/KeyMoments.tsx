"use client";

import type { ScoreEvidence } from "@/lib/engine/scoring";
import type { TranscriptTurn } from "@/types/simulation";
import { cn } from "@/lib/utils";

interface KeyMomentsProps {
  moments: ScoreEvidence[];
  turns: TranscriptTurn[];
}

const DIMENSION_LABELS: Record<string, string> = {
  composure: "Composure",
  de_escalation: "De-escalation",
  clinical_task: "Clinical Task",
  support_seeking: "Support Seeking",
};

const EVIDENCE_DESCRIPTIONS: Record<string, (data: Record<string, unknown>) => string> = {
  composure_marker: (data) => {
    const markers = data.markers as string[] | undefined;
    if (!markers?.length) return "Composure marker detected";
    const labels = markers.map((m) => m.replace(/_/g, " "));
    return labels.join(", ");
  },
  de_escalation_attempt: (data) => {
    const technique = data.technique as string | undefined;
    const effective = data.effective as boolean;
    const clinicianIntervened = data.clinicianIntervened as boolean | undefined;
    if (clinicianIntervened) {
      return technique
        ? `${technique.replace(/_/g, " ")} — not credited because the AI clinician intervened before the next patient response`
        : "Not credited because the AI clinician intervened before the next patient response";
    }
    if (technique) {
      return `${technique.replace(/_/g, " ")} — ${effective ? "effective" : "not effective"}`;
    }
    return effective ? "Effective de-escalation" : "De-escalation attempt did not reduce escalation";
  },
  milestone_completed: (data) => {
    const desc = data.description as string | undefined;
    return desc ? `Addressed the clinical need: ${desc}` : "Addressed a clinical need during the conversation";
  },
  support_invoked: (data) => {
    const appropriate = data.appropriate as boolean;
    const level = data.escalationLevel as number | undefined;
    return appropriate
      ? `Appropriately sought help (escalation at ${level})`
      : `Sought help prematurely (escalation at ${level})`;
  },
  critical_no_support: (data) => {
    const level = data.escalationLevel as number | undefined;
    return `Critical escalation at level ${level} without seeking support`;
  },
};

function describeEvidence(evidence: ScoreEvidence): string {
  const fn = EVIDENCE_DESCRIPTIONS[evidence.evidenceType];
  if (fn) return fn(evidence.evidenceData);
  return evidence.evidenceType.replace(/_/g, " ");
}

export function KeyMoments({ moments, turns }: KeyMomentsProps) {
  if (moments.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Key moments</h3>
      <div className="space-y-2">
        {moments.map((moment, i) => {
          const turn = turns.find((t) => t.turn_index === moment.turnIndex);
          const isPositive = moment.scoreImpact > 0;
          const isNegative = moment.scoreImpact < 0;

          return (
            <div
              key={i}
              className={cn(
                "rounded-lg border p-3",
                isPositive && "border-emerald-200 bg-emerald-50/50",
                isNegative && "border-red-200 bg-red-50/50",
                !isPositive && !isNegative && "border-slate-200 bg-slate-50/50"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={cn(
                  "text-[10px] font-medium uppercase tracking-wide",
                  isPositive ? "text-emerald-600" : isNegative ? "text-red-600" : "text-slate-500"
                )}>
                  {DIMENSION_LABELS[moment.dimension] ?? moment.dimension} — Turn {moment.turnIndex + 1}
                </span>
                {moment.scoreImpact !== 0 && (
                  <span className={cn(
                    "text-[10px] font-bold tabular-nums",
                    isPositive ? "text-emerald-600" : "text-red-600"
                  )}>
                    {isPositive ? "+" : ""}{Math.round(moment.scoreImpact)}
                  </span>
                )}
              </div>
              {turn && (
                <p className="text-[12px] text-slate-700 italic line-clamp-2">
                  &ldquo;{turn.content}&rdquo;
                </p>
              )}
              <p className="mt-1 text-[12px] text-slate-500">
                {describeEvidence(moment)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
