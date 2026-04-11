"use client";

import type { ScoreEvidence } from "@/lib/engine/scoring";
import {
  buildReviewMomentNarrative,
  getMomentTurnContext,
} from "@/lib/review/feedback";
import type { TranscriptTurn } from "@/types/simulation";
import { cn } from "@/lib/utils";
import { MomentTranscriptContext } from "@/components/review/MomentTranscriptContext";

interface KeyMomentsProps {
  moments: ScoreEvidence[];
  turns: TranscriptTurn[];
  sessionStartedAt: string | null | undefined;
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
    return markers.map((marker) => marker.replace(/_/g, " ")).join(", ");
  },
  low_substance_response: () => "Low-substance response",
  delivery_marker: (data) => {
    const summary = data.summary as string | undefined;
    return summary ?? "Audio delivery note";
  },
  de_escalation_attempt: (data) => {
    const technique = data.technique as string | undefined;
    return technique ? `${technique.replace(/_/g, " ")} attempt` : "De-escalation attempt";
  },
  de_escalation_harm: (data) => {
    const technique = data.technique as string | undefined;
    return technique ? `${technique.replace(/_/g, " ")} backfired` : "Escalating response";
  },
  milestone_completed: (data) => {
    const description = data.description as string | undefined;
    return description ? `Clinical task: ${description}` : "Clinical task maintained";
  },
  support_invoked: () => "Support requested",
  support_not_requested: () => "Support opportunity missed",
  critical_no_support: () => "Critical support opportunity missed",
};

export function describeEvidence(evidence: ScoreEvidence): string {
  const fn = EVIDENCE_DESCRIPTIONS[evidence.evidenceType];
  if (fn) return fn(evidence.evidenceData);
  return evidence.evidenceType.replace(/_/g, " ");
}

function KeyMomentCard({
  moment,
  turns,
  sessionStartedAt,
  isActive = false,
}: {
  moment: ScoreEvidence;
  turns: TranscriptTurn[];
  sessionStartedAt: string | null | undefined;
  isActive?: boolean;
}) {
  const narrative = buildReviewMomentNarrative(moment, turns, sessionStartedAt);
  const context = getMomentTurnContext(turns, moment.turnIndex);

  return (
    <div
      aria-current={isActive ? "step" : undefined}
      className={cn(
        "rounded-2xl border p-4 transition-all",
        narrative.positive
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-amber-200 bg-amber-50/60",
        isActive && "ring-2 ring-slate-900/15 shadow-md"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {narrative.timecode} • {DIMENSION_LABELS[moment.dimension] ?? moment.dimension}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
            narrative.positive
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-800"
          )}
        >
          {narrative.positive ? "Helpful moment" : "Moment to revisit"}
        </span>
        {isActive && (
          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-medium text-white">
            In focus
          </span>
        )}
      </div>

      <h3 className="mt-3 text-base font-semibold text-slate-900">
        {narrative.headline}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
        {narrative.likelyImpact}
      </p>

      <div className="mt-4">
        <MomentTranscriptContext
          previousTurn={context.previousTurn}
          focusTurn={context.focusTurn}
          nextTurn={context.nextTurn}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/90 bg-white/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            What happened next
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
            {narrative.whatHappenedNext}
          </p>
        </div>
        <div className="rounded-xl border border-white/90 bg-white/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Why it mattered here
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
            {narrative.whyItMattered}
          </p>
        </div>
      </div>

      {narrative.tryInstead && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/80 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            Try saying
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
            &ldquo;{narrative.tryInstead}&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}

export function KeyMoments({
  moments,
  turns,
  sessionStartedAt,
  activeMomentIndex = null,
}: KeyMomentsProps) {
  if (moments.length === 0) return null;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          Moments That Shaped The Conversation
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Each moment shows what was said, how it likely landed, what happened next, and how you might handle a similar moment next time.
        </p>
      </div>
      <div className="space-y-3">
        {moments.map((moment, index) => (
          <KeyMomentCard
            key={`${moment.dimension}-${moment.turnIndex}-${moment.evidenceType}-${index}`}
            moment={moment}
            turns={turns}
            sessionStartedAt={sessionStartedAt}
            isActive={activeMomentIndex === index}
          />
        ))}
      </div>
    </div>
  );
}

