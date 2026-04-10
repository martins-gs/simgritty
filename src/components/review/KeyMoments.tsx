"use client";

import type { ScoreEvidence } from "@/lib/engine/scoring";
import type { TranscriptTurn } from "@/types/simulation";
import { cn } from "@/lib/utils";

interface KeyMomentsProps {
  moments: ScoreEvidence[];
  turns: TranscriptTurn[];
  activeMomentIndex?: number | null;
}

export const DIMENSION_LABELS: Record<string, string> = {
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
  delivery_marker: (data) => {
    const markers = data.markers as string[] | undefined;
    const summary = data.summary as string | undefined;
    const confidence = typeof data.confidence === "number"
      ? Math.round(data.confidence * 100)
      : null;
    const pairedWithAttempt = data.pairedWithAttempt as boolean | undefined;

    if (summary) {
      return pairedWithAttempt && confidence != null
        ? `${summary} (${confidence}% confidence during the de-escalation attempt)`
        : pairedWithAttempt
          ? `${summary} during the de-escalation attempt`
          : confidence != null
            ? `${summary} (${confidence}% confidence)`
            : summary;
    }

    const labels = markers?.map((marker) => marker.replace(/_/g, " ")) ?? [];
    if (!labels.length) {
      return "Audio-derived delivery affected scoring";
    }

    const markerText = labels.join(", ");
    return pairedWithAttempt
      ? `Audio delivery during the de-escalation attempt sounded ${markerText}`
      : `Audio delivery sounded ${markerText}`;
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
  de_escalation_harm: (data) => {
    const technique = data.technique as string | undefined;
    const effectiveness = data.effectiveness as number | undefined;
    if (technique && effectiveness != null) {
      return `${technique.replace(/_/g, " ")} increased tension (${effectiveness.toFixed(1)})`;
    }
    return "This turn increased the patient or relative's emotional intensity";
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
  support_not_requested: (data) => {
    const level = data.escalationLevel as number | undefined;
    return `Support was indicated at level ${level}, but the trainee continued without requesting intervention`;
  },
  critical_no_support: (data) => {
    const level = data.escalationLevel as number | undefined;
    if (data.crisisReached) {
      return `The conversation reached level ${level} without support after earlier missed intervention opportunities`;
    }
    if (data.delayedEscalation) {
      return `After missed support opportunities, the conversation worsened to level ${level}`;
    }
    if (data.missedOpportunity) {
      return `Critical support opportunity missed at level ${level}`;
    }
    return `Critical escalation at level ${level} without seeking support`;
  },
};

export function describeEvidence(evidence: ScoreEvidence): string {
  const fn = EVIDENCE_DESCRIPTIONS[evidence.evidenceType];
  if (fn) return fn(evidence.evidenceData);
  return evidence.evidenceType.replace(/_/g, " ");
}

export function KeyMomentCard({
  moment,
  turn,
  isActive = false,
}: {
  moment: ScoreEvidence;
  turn: TranscriptTurn | undefined;
  isActive?: boolean;
}) {
  const isPositive = moment.scoreImpact > 0;
  const isNegative = moment.scoreImpact < 0;

  return (
    <div
      aria-current={isActive ? "step" : undefined}
      className={cn(
        "rounded-lg border p-3 transition-all",
        isPositive && "border-emerald-200 bg-emerald-50/50",
        isNegative && "border-red-200 bg-red-50/50",
        !isPositive && !isNegative && "border-slate-200 bg-slate-50/50",
        isActive && "ring-2 ring-slate-900/15 shadow-md"
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
        {isActive && (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
            Now
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
}

export function KeyMoments({ moments, turns, activeMomentIndex = null }: KeyMomentsProps) {
  if (moments.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">Key moments</h3>
      <div className="space-y-2">
        {moments.map((moment, i) => {
          const turn = turns.find((t) => t.turn_index === moment.turnIndex);
          return (
            <KeyMomentCard
              key={i}
              moment={moment}
              turn={turn}
              isActive={activeMomentIndex === i}
            />
          );
        })}
      </div>
    </div>
  );
}
