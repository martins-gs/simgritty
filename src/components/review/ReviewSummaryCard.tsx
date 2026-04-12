"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScoreBreakdown, ScoreEvidence } from "@/lib/engine/scoring";
import {
  buildFallbackReviewSummary,
  buildReviewSummaryMomentInput,
  reviewSummaryResponseSchema,
  type ReviewSummaryData,
} from "@/lib/review/feedback";
import type { ScenarioMilestone, ScenarioTraits } from "@/types/scenario";
import type { SimulationSession, TranscriptTurn } from "@/types/simulation";

interface ReviewSummaryCardProps {
  sessionId: string;
  session: SimulationSession;
  score: ScoreBreakdown;
  turns: TranscriptTurn[];
  keyMoments: ScoreEvidence[];
  learningObjectives?: string | null;
  milestones?: ScenarioMilestone[];
  aiRole?: string | null;
  backstory?: string | null;
  emotionalDriver?: string | null;
  traits?: ScenarioTraits | null;
}

export function ReviewSummaryCard({
  sessionId,
  session,
  score,
  turns,
  keyMoments,
  learningObjectives,
  milestones = [],
  aiRole,
  backstory,
  emotionalDriver,
  traits,
}: ReviewSummaryCardProps) {
  const rawStoredSummary = useMemo(() => {
    const parsed = reviewSummaryResponseSchema.safeParse(session.review_summary);
    return parsed.success ? parsed.data : null;
  }, [session.review_summary]);
  const fallbackSummary = useMemo(() => buildFallbackReviewSummary(session, score, turns, keyMoments, {
    milestones,
    learningObjectives,
    aiRole,
    backstory,
    emotionalDriver,
    traits,
  }), [
    aiRole,
    backstory,
    emotionalDriver,
    keyMoments,
    learningObjectives,
    milestones,
    score,
    session,
    traits,
    turns,
  ]);
  const storedSummary = useMemo(() => {
    if (!rawStoredSummary) return null;
    return {
      ...rawStoredSummary,
      overallDelivery: rawStoredSummary.overallDelivery ?? fallbackSummary.overallDelivery,
    };
  }, [fallbackSummary.overallDelivery, rawStoredSummary]);
  const shouldRequestGeneratedSummary = !rawStoredSummary && score.sessionValid && keyMoments.length > 0;
  const reviewSummaryRequest = useMemo(() => ({
    scenarioTitle: session.scenario_templates?.title || "Simulation",
    learningObjectives: learningObjectives ?? null,
    backstory: backstory ?? null,
    emotionalDriver: emotionalDriver ?? null,
    personSummary: fallbackSummary.personFocus,
    finalEscalationLevel: session.final_escalation_level ?? null,
    exitType: session.exit_type ?? null,
    fallback: fallbackSummary,
    achievedObjectives: fallbackSummary.achievedObjectives,
    outstandingObjectives: fallbackSummary.outstandingObjectives,
    moments: keyMoments
      .slice(0, 4)
      .map((moment) => buildReviewSummaryMomentInput(moment, turns, session.started_at)),
  }), [
    backstory,
    emotionalDriver,
    fallbackSummary,
    keyMoments,
    learningObjectives,
    session.exit_type,
    session.final_escalation_level,
    session.scenario_templates?.title,
    session.started_at,
    turns,
  ]);
  const requestKey = useMemo(() => JSON.stringify({
    sessionId,
    request: reviewSummaryRequest,
    aiRole: aiRole ?? null,
    traits: traits ?? null,
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      order: milestone.order,
      description: milestone.description,
    })),
  }), [
    aiRole,
    milestones,
    reviewSummaryRequest,
    sessionId,
    traits,
  ]);
  const [summaryState, setSummaryState] = useState<{
    requestKey: string;
    status: "ready" | "fallback";
    data: ReviewSummaryData;
  } | null>(null);
  const currentSummaryState = summaryState?.requestKey === requestKey ? summaryState : null;
  const generatedSummary = currentSummaryState
    ? {
        ...currentSummaryState.data,
        overallDelivery: currentSummaryState.data.overallDelivery ?? fallbackSummary.overallDelivery,
      }
    : null;
  const summary = storedSummary
    ?? generatedSummary
    ?? (!shouldRequestGeneratedSummary ? fallbackSummary : null);
  const loadingGeneratedSummary = shouldRequestGeneratedSummary && !currentSummaryState;
  const coachingFocus = useMemo(() => {
    if (!summary) return null;

    const parts = [
      summary.coachingFocus?.trim() || null,
      summary.objectiveFocus?.trim() || null,
      summary.personFocus?.trim() || null,
    ].filter((part): part is string => Boolean(part));

    if (parts.length === 0) return null;

    return parts.filter((part, index) => (
      !parts.slice(0, index).some((existing) => existing.includes(part) || part.includes(existing))
    )).join(" ");
  }, [summary]);
  const objectiveItems = useMemo(() => (
    (learningObjectives ?? "")
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
  ), [learningObjectives]);

  useEffect(() => {
    if (!shouldRequestGeneratedSummary) {
      return;
    }

    let cancelled = false;

    async function loadSummary() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/review-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reviewSummaryRequest),
        });
        const payload = await res.json().catch(() => null);
        if (cancelled) return;

        const parsed = reviewSummaryResponseSchema.safeParse(payload);
        if (parsed.success) {
          setSummaryState({
            requestKey,
            status: "ready",
            data: parsed.data,
          });
          return;
        }

        setSummaryState({
          requestKey,
          status: "fallback",
          data: fallbackSummary,
        });
      } catch {
        if (cancelled) return;
        setSummaryState({
          requestKey,
          status: "fallback",
          data: fallbackSummary,
        });
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [
    fallbackSummary,
    requestKey,
    shouldRequestGeneratedSummary,
    reviewSummaryRequest,
    sessionId,
  ]);

  if (loadingGeneratedSummary || !summary) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
            Session summary
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            Preparing educator-style review...
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-[92%] animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-[84%] animate-pulse rounded bg-slate-100" />
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-[88%] animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-[72%] animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
          Session summary
        </div>
        <p className="mt-3 text-base leading-relaxed text-slate-900 sm:text-lg">
          {summary.overview}
        </p>
        {summary.overallDelivery && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
              Overall Delivery
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
              {summary.overallDelivery}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
            What Helped
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {summary.positiveMoment ?? "A steadier moment will be highlighted below if one is visible in this session."}
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
            Why It Mattered
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {coachingFocus ?? "Look for the moment below where the interaction changed direction."}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            Try This Move
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {summary.whatToSayInstead
              ? summary.whatToSayInstead
              : "A suggested communication move will appear here when the review identifies a clear coaching opportunity."}
          </p>
        </div>
      </div>

      {objectiveItems.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Learning Objectives
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {objectiveItems.map((objective) => (
                <li
                  key={objective}
                  className="rounded-lg border border-white/90 bg-white/80 px-3 py-2 text-[13px] leading-relaxed text-slate-700"
                >
                  {objective}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
