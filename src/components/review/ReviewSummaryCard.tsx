"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  reviewDebugSchema,
  reviewSummaryApiResponseSchema,
  type ReviewSummaryData,
} from "@/lib/review/feedback";
import {
  parseStoredReviewArtifacts,
} from "@/lib/review/artifacts";
import type { SimulationSession, TranscriptTurn } from "@/types/simulation";

const reviewSummaryResultCache = new Map<string, {
  summary: ReviewSummaryData | null;
  debug: z.infer<typeof reviewDebugSchema>;
}>();
const reviewSummaryRequestCache = new Map<string, Promise<{
  summary: ReviewSummaryData | null;
  debug: z.infer<typeof reviewDebugSchema>;
}>>();

interface ReviewSummaryCardProps {
  sessionId: string;
  session: SimulationSession;
  turns: TranscriptTurn[];
  learningObjectives?: string | null;
}

export function ReviewSummaryCard({
  sessionId,
  session,
  turns,
  learningObjectives,
}: ReviewSummaryCardProps) {
  const storedArtifacts = useMemo(
    () => parseStoredReviewArtifacts(session.review_artifacts),
    [session.review_artifacts]
  );
  const storedSummary = useMemo(() => {
    return storedArtifacts?.summary ?? null;
  }, [storedArtifacts]);
  const storedDebug = useMemo(() => {
    if (!storedArtifacts?.summary && !storedArtifacts?.meta.summary) {
      return null;
    }

    const parsed = reviewDebugSchema.safeParse({
      ok: Boolean(storedArtifacts?.summary),
      message: storedArtifacts?.summary
        ? null
        : storedArtifacts?.meta.summary
          ? "Session summary unavailable. Review the debug codes below to see why generation failed."
          : null,
      promptVersion: storedArtifacts?.meta.summary?.prompt_version ?? null,
      schemaVersion: storedArtifacts?.meta.summary?.schema_version ?? null,
      model: storedArtifacts?.meta.summary?.model ?? null,
      reasoningEffort: storedArtifacts?.meta.summary?.reasoning_effort ?? null,
      fallbackUsed: storedArtifacts?.meta.summary?.fallback_used ?? false,
      failureClass: storedArtifacts?.meta.summary?.failure_class ?? null,
      validatorFailures: storedArtifacts?.meta.summary?.validator_failures ?? [],
    });
    return parsed.success ? parsed.data : null;
  }, [storedArtifacts]);
  const shouldRequestGeneratedSummary = !storedSummary && turns.some((turn) => turn.speaker === "trainee");
  const lastTurnIndex = turns[turns.length - 1]?.turn_index ?? null;
  const requestKey = useMemo(() => JSON.stringify({
    sessionId,
    evidenceHash: storedArtifacts?.evidence_hash ?? null,
    turnCount: turns.length,
    lastTurnIndex,
  }), [
    sessionId,
    storedArtifacts?.evidence_hash,
    turns.length,
    lastTurnIndex,
  ]);
  const [summaryState, setSummaryState] = useState<{
    requestKey: string;
    summary: ReviewSummaryData | null;
    debug: z.infer<typeof reviewDebugSchema>;
  } | null>(null);
  const currentSummaryState = summaryState?.requestKey === requestKey ? summaryState : null;
  const generatedSummary = currentSummaryState?.summary ?? null;
  const runtimeDebug = currentSummaryState?.debug ?? null;
  const summary = storedSummary
    ?? generatedSummary
    ?? null;
  const debug = storedDebug ?? runtimeDebug;
  const loadingGeneratedSummary = shouldRequestGeneratedSummary && !currentSummaryState;
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
      const cachedResult = reviewSummaryResultCache.get(requestKey);
      if (cachedResult) {
        setSummaryState({
          requestKey,
          ...cachedResult,
        });
        return;
      }

      let requestPromise = reviewSummaryRequestCache.get(requestKey);
      if (!requestPromise) {
        requestPromise = (async () => {
          try {
            const res = await fetch(`/api/sessions/${sessionId}/review-summary`, {
              method: "POST",
              cache: "no-store",
            });
            const payload = await res.json().catch(() => null);
            const parsed = reviewSummaryApiResponseSchema.safeParse(payload);

            if (parsed.success) {
              return parsed.data;
            }

            return {
              summary: null,
              debug: {
                ok: false,
                message: "Session summary unavailable. The API returned an unexpected payload.",
                promptVersion: null,
                schemaVersion: null,
                model: null,
                reasoningEffort: null,
                fallbackUsed: false,
                failureClass: "schema" as const,
                validatorFailures: ["invalid_api_payload"],
              },
            };
          } catch {
            return {
              summary: null,
              debug: {
                ok: false,
                message: "Session summary unavailable. The request failed before a valid response was returned.",
                promptVersion: null,
                schemaVersion: null,
                model: null,
                reasoningEffort: null,
                fallbackUsed: false,
                failureClass: "schema" as const,
                validatorFailures: ["request_failed"],
              },
            };
          }
        })().finally(() => {
          reviewSummaryRequestCache.delete(requestKey);
        });
        reviewSummaryRequestCache.set(requestKey, requestPromise);
      }

      const result = await requestPromise;
      if (result.debug.ok || result.summary) {
        reviewSummaryResultCache.set(requestKey, result);
      }
      if (cancelled) return;
      setSummaryState({
        requestKey,
        ...result,
      });
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [
    requestKey,
    shouldRequestGeneratedSummary,
    sessionId,
  ]);

  if (loadingGeneratedSummary || !summary) {
    if (!loadingGeneratedSummary && debug && !debug.ok) {
      return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 shadow-sm">
          <div className="border-b border-rose-200/80 px-5 py-4">
            <div className="inline-flex rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
              Session summary unavailable
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-700">
              {debug.message ?? "The summary could not be generated for this session."}
            </p>
          </div>
          <div className="space-y-3 px-5 py-4 text-[12px] text-slate-700">
            {debug.failureClass && (
              <p><span className="font-semibold text-slate-900">Failure class:</span> {debug.failureClass}</p>
            )}
            {debug.validatorFailures.length > 0 && (
              <div>
                <p className="font-semibold text-slate-900">Validator codes</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {debug.validatorFailures.map((issue) => (
                    <li key={issue} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] text-rose-700">
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (!loadingGeneratedSummary && !summary) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
              Session summary unavailable
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
              There was not enough usable review output to show a summary for this session.
            </p>
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
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            Analysing the conversation and tailoring coaching to this case. This can take up to a minute.
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
            {summary.positiveMoment ?? "No single positive move stood out strongly enough to highlight on its own."}
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
            Why It Mattered
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {summary.whyItMattered ?? "See the timeline below for the moment that most shaped the conversation and why it mattered here."}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            Next Best Move
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {summary.whatToSayInstead
              ? summary.whatToSayInstead
              : "A next best move will appear here when the review identifies one clear coaching opportunity."}
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
