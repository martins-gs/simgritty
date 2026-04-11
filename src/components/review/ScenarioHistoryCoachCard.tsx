"use client";

import { useEffect, useState } from "react";
import {
  scenarioHistoryCoachResponseSchema,
  type ScenarioHistoryCoachResponse,
} from "@/lib/review/history";

interface ScenarioHistoryCoachCardProps {
  sessionId: string;
}

const FALLBACK_HISTORY_SUMMARY: ScenarioHistoryCoachResponse = {
  totalSessions: 1,
  sessionLabel: "1 non-deleted session in this scenario",
  headline: "Use repeated runs of this scenario to turn one coaching point into a habit.",
  progress: "Look for the moment where the tone starts to tip, because that is usually where the most useful learning sits.",
  development: "Keep the next target narrow: one calmer opening, one clearer explanation, or one firmer boundary.",
  practiceTarget: "On the next attempt, choose one phrase you want to say more clearly and use it earlier.",
};

export function ScenarioHistoryCoachCard({ sessionId }: ScenarioHistoryCoachCardProps) {
  const [summary, setSummary] = useState<ScenarioHistoryCoachResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);

      try {
        const res = await fetch(`/api/sessions/${sessionId}/scenario-history`, {
          cache: "no-store",
        });
        const payload = await res.json().catch(() => null);
        if (cancelled) return;

        const parsed = scenarioHistoryCoachResponseSchema.safeParse(payload);
        setSummary(parsed.success ? parsed.data : FALLBACK_HISTORY_SUMMARY);
      } catch {
        if (!cancelled) {
          setSummary(FALLBACK_HISTORY_SUMMARY);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading && !summary) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
            Review your progress
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-[90%] animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
              <div className="mt-3 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-[84%] animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const resolvedSummary = summary ?? FALLBACK_HISTORY_SUMMARY;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
          Review your progress
        </div>
        <p className="mt-3 text-base leading-relaxed text-slate-900 sm:text-lg">
          {resolvedSummary.headline}
        </p>
        <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
          {resolvedSummary.sessionLabel}
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
            What is improving
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {resolvedSummary.progress}
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
            Keep developing
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {resolvedSummary.development}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            Practice target
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
            {resolvedSummary.practiceTarget}
          </p>
        </div>
      </div>
    </div>
  );
}
