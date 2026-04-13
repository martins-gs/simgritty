"use client";

import { useEffect, useState } from "react";
import {
  scenarioHistoryApiResponseSchema,
  type ScenarioHistoryApiResponse,
} from "@/lib/review/history";
import {
  heatmapPlainCardClass,
  heatmapPlumCardClass,
  heatmapPlumCardStyle,
  heatmapSageCardClass,
  heatmapSageCardStyle,
  heatmapShellClass,
  heatmapShellStyle,
  heatmapSoftCardClass,
  heatmapSoftCardStyle,
  heatmapWarmCardClass,
  heatmapWarmCardStyle,
} from "@/lib/ui/insightTheme";

interface ScenarioHistoryCoachCardProps {
  sessionId: string;
}

const scenarioHistoryResultCache = new Map<string, ScenarioHistoryApiResponse>();
const scenarioHistoryRequestCache = new Map<string, Promise<ScenarioHistoryApiResponse>>();
const loadingCardVariants = [
  {
    className: heatmapSageCardClass,
    style: heatmapSageCardStyle,
  },
  {
    className: heatmapWarmCardClass,
    style: heatmapWarmCardStyle,
  },
  {
    className: heatmapPlainCardClass,
    style: undefined,
  },
  {
    className: heatmapPlumCardClass,
    style: heatmapPlumCardStyle,
  },
] as const;

function buildUnavailableResponse(
  message: string,
  validatorFailures: string[]
): ScenarioHistoryApiResponse {
  return {
    summary: null,
    debug: {
      ok: false,
      message,
      promptVersion: null,
      schemaVersion: null,
      model: null,
      reasoningEffort: null,
      fallbackUsed: false,
      failureClass: "schema",
      validatorFailures,
    },
  };
}

export function ScenarioHistoryCoachCard({ sessionId }: ScenarioHistoryCoachCardProps) {
  const [response, setResponse] = useState<ScenarioHistoryApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);

      const cachedResult = scenarioHistoryResultCache.get(sessionId);
      if (cachedResult) {
        setResponse(cachedResult);
        setLoading(false);
        return;
      }

      let requestPromise: Promise<ScenarioHistoryApiResponse> | undefined = scenarioHistoryRequestCache.get(sessionId);
      if (!requestPromise) {
        requestPromise = (async () => {
          try {
            const res = await fetch(`/api/sessions/${sessionId}/scenario-history`, {
              cache: "no-store",
            });
            const payload = await res.json().catch(() => null);
            const parsed = scenarioHistoryApiResponseSchema.safeParse(payload);
            return parsed.success
              ? parsed.data
              : buildUnavailableResponse(
                  "Progress analysis unavailable. The API returned an unexpected payload.",
                  ["invalid_api_payload"]
                );
          } catch {
            return buildUnavailableResponse(
              "Progress analysis unavailable. The request failed before a valid response was returned.",
              ["request_failed"]
            );
          }
        })().finally(() => {
          scenarioHistoryRequestCache.delete(sessionId);
        });
        scenarioHistoryRequestCache.set(sessionId, requestPromise);
      }

      if (!requestPromise) {
        return;
      }

      const result = await requestPromise;
      if (result.debug.ok || result.summary) {
        scenarioHistoryResultCache.set(sessionId, result);
      }
      if (cancelled) return;
      setResponse(result);
      setLoading(false);
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading && !response) {
    return (
      <div className={`${heatmapShellClass} overflow-hidden`} style={heatmapShellStyle}>
        <div className="border-b border-slate-200/70 px-5 py-4">
          <div className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
            Review your progress
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
            Analysing repeated runs of this scenario and tailoring the coaching. This can take up to a minute.
          </p>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-4 w-[90%] animate-pulse rounded bg-slate-100" />
          </div>
        </div>
        <div className="space-y-4 px-5 py-5">
          {loadingCardVariants.map((variant, index) => (
            <div key={index} className={`${variant.className} p-4`} style={variant.style}>
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

  if (!loading && response && !response.debug.ok && !response.summary) {
    return (
      <div className={`${heatmapShellClass} overflow-hidden`} style={heatmapShellStyle}>
        <div className="border-b border-rose-200/80 px-5 py-4">
          <div className="inline-flex rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
            Review your progress unavailable
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-700">
            {response.debug.message ?? "The progress panel could not be generated for this scenario."}
          </p>
        </div>
        <div className="space-y-3 px-5 py-4 text-[12px] text-slate-700">
          {response.debug.failureClass && (
            <p><span className="font-semibold text-slate-900">Failure class:</span> {response.debug.failureClass}</p>
          )}
          {response.debug.validatorFailures.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {response.debug.validatorFailures.map((issue) => (
                <span key={issue} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] text-rose-700">
                  {issue}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const resolvedSummary = response?.summary;
  if (!resolvedSummary) {
    return null;
  }

  return (
    <div className={`${heatmapShellClass} overflow-hidden`} style={heatmapShellStyle}>
      <div className="border-b border-slate-200/70 px-5 py-4">
        <div className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
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
        <div className={`${heatmapSageCardClass} p-4`} style={heatmapSageCardStyle}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#355644]">
            What is improving
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#355644]">
            {resolvedSummary.progress}
          </p>
        </div>

        <div className={`${heatmapWarmCardClass} p-4`} style={heatmapWarmCardStyle}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4b2d12]">
            Main target
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#4b2d12]">
            {resolvedSummary.primaryTarget}
          </p>
        </div>

        <div className={`${heatmapSoftCardClass} p-4`} style={heatmapSoftCardStyle}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-700">
            Also Keep In View
          </p>
          {resolvedSummary.secondaryPatterns.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {resolvedSummary.secondaryPatterns.map((pattern) => (
                <li
                  key={pattern}
                  className="rounded-lg border border-white/90 bg-white/72 px-3 py-2 text-[13px] leading-relaxed text-slate-700"
                >
                  {pattern}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] leading-relaxed text-slate-700">
              Keep the rest of the coaching narrow for now so the main target has a chance to become a habit.
            </p>
          )}
        </div>

        <div className={`${heatmapPlumCardClass} p-4`} style={heatmapPlumCardStyle}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4d3f68]">
            Practice target
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[#4d3f68]">
            {resolvedSummary.practiceTarget}
          </p>
        </div>
      </div>
    </div>
  );
}
