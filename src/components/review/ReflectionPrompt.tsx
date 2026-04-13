"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  insightBadgeClass,
  insightGlassCardClass,
  insightHeroClass,
  reviewHeroStyle,
} from "@/lib/ui/insightTheme";
import { parseSessionReflection } from "@/lib/validation/schemas";
import type { SessionReflection } from "@/types/simulation";

interface ReflectionPromptProps {
  sessionId: string;
}

const reflectionResultCache = new Map<string, SessionReflection | null>();
const reflectionRequestCache = new Map<string, Promise<SessionReflection | null>>();

const TAGS = [
  { value: "frustrated", label: "Frustrated" },
  { value: "anxious", label: "Anxious" },
  { value: "confident", label: "Confident" },
  { value: "drained", label: "Drained" },
  { value: "fine", label: "Fine" },
];

export function ReflectionPrompt({ sessionId }: ReflectionPromptProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [savedReflection, setSavedReflection] = useState<SessionReflection | null>(null);
  const [loadingSavedReflection, setLoadingSavedReflection] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSavedReflection() {
      setLoadingSavedReflection(true);
      setErrorMessage(null);

      const cachedResult = reflectionResultCache.get(sessionId);
      if (cachedResult !== undefined) {
        setSavedReflection(cachedResult);
        setSelectedTags(cachedResult?.tags ?? []);
        setFreeText(cachedResult?.free_text ?? "");
        setLoadingSavedReflection(false);
        return;
      }

      try {
        let requestPromise = reflectionRequestCache.get(sessionId);
        if (!requestPromise) {
          requestPromise = (async () => {
            const res = await fetch(`/api/sessions/${sessionId}/reflection`);
            const payload = await res.json().catch(() => null);

            if (!res.ok) {
              throw new Error(
                typeof payload?.error === "string"
                  ? payload.error
                  : "Unable to load saved reflection for this session."
              );
            }

            return parseSessionReflection(payload);
          })().finally(() => {
            reflectionRequestCache.delete(sessionId);
          });
          reflectionRequestCache.set(sessionId, requestPromise);
        }

        const reflection = await requestPromise;
        reflectionResultCache.set(sessionId, reflection);
        if (cancelled) return;
        setSavedReflection(reflection);
        setSelectedTags(reflection?.tags ?? []);
        setFreeText(reflection?.free_text ?? "");
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error && error.message
              ? error.message
              : "Unable to load saved reflection for this session."
          );
          setSavedReflection(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingSavedReflection(false);
        }
      }
    }

    void loadSavedReflection();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function toggleTag(tag: string) {
    setStatusMessage(null);
    setErrorMessage(null);
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    const trimmedFreeText = freeText.trim();
    if (selectedTags.length === 0 && !trimmedFreeText) return;

    setSubmitting(true);
    setStatusMessage(null);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reflection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: selectedTags,
          free_text: trimmedFreeText || null,
        }),
      });
      const payload = await res.json().catch(() => null);

      if (res.ok) {
        const reflection = parseSessionReflection(payload);
        if (reflection) {
          reflectionResultCache.set(sessionId, reflection);
          setSavedReflection(reflection);
          setSelectedTags(reflection.tags);
          setFreeText(reflection.free_text ?? "");
        }
        setStatusMessage(savedReflection ? "Reflection updated for this session." : "Reflection saved for this session.");
      } else {
        const nextError =
          typeof payload?.error === "string"
            ? payload.error
            : "Failed to save reflection. You can try again.";
        setErrorMessage(nextError);
        toast.error(nextError);
      }
    } catch {
      const nextError = "Failed to save reflection. You can try again.";
      setErrorMessage(nextError);
      toast.error(nextError);
    } finally {
      setSubmitting(false);
    }
  }

  const hasInput = selectedTags.length > 0 || freeText.trim().length > 0;
  const canSubmit = hasInput && !submitting && !loadingSavedReflection;
  const buttonLabel = submitting
    ? "Saving..."
    : savedReflection
      ? "Update reflection"
      : "Save reflection";
  const helperText = errorMessage
    ? errorMessage
    : statusMessage
      ? statusMessage
      : loadingSavedReflection
        ? "Checking whether you already saved a reflection for this session..."
        : savedReflection
          ? "This reflection is already saved to your session. You can update it below."
          : "Choose at least one feeling or add a note, then save it to this session.";

  return (
    <div className={`${insightHeroClass} h-full space-y-4 p-5 sm:p-6`} style={reviewHeroStyle}>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className={insightBadgeClass}>
            Reflection check-in
          </div>
          <div
            className={cn(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
              savedReflection
                ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200"
                : "border-white/10 bg-white/[0.06] text-white/70"
            )}
          >
            {savedReflection ? "Saved to this session" : "Not yet saved"}
          </div>
        </div>

        <div className={`${insightGlassCardClass} p-4`}>
          <p className="text-sm font-semibold text-white">
            Encounters like this can be draining, even in simulation. How did this one feel?
          </p>
          <p className="mt-2 text-[12px] leading-5 text-white/70">
            This section is asking for your own reaction. It is not scored and is not part
            of your performance record.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TAGS.map((tag) => (
          <button
            key={tag.value}
            type="button"
            onClick={() => toggleTag(tag.value)}
            aria-pressed={selectedTags.includes(tag.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              selectedTags.includes(tag.value)
                ? "border-[#f0bb7e] bg-[#f8a757] text-[#4b2d12] shadow-sm"
                : "border-white/12 bg-white/[0.08] text-white/76 hover:border-white/18 hover:bg-white/[0.12] hover:text-white"
            )}
          >
            {tag.label}
          </button>
        ))}
      </div>

      <Textarea
        value={freeText}
        onChange={(e) => {
          setStatusMessage(null);
          setErrorMessage(null);
          setFreeText(e.target.value);
        }}
        placeholder="How do you think that conversation went? (optional)"
        rows={2}
        className="border-white/10 bg-white/[0.06] text-sm text-white shadow-none placeholder:text-white/40 focus-visible:border-[#f8a757] focus-visible:ring-[#f8a757]/40"
      />

      <div className={`${insightGlassCardClass} p-4`}>
        <p
          className={cn(
            "text-[12px] leading-5",
            errorMessage
              ? "text-rose-200"
              : statusMessage || savedReflection
                ? "text-emerald-200"
                : "text-white/65"
          )}
        >
          {helperText}
        </p>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="lg"
          className={cn(
            "mt-3 w-full rounded-xl border text-sm font-semibold shadow-sm disabled:opacity-100",
            canSubmit
              ? "border-[#f0bb7e] bg-[#f8a757] text-[#4b2d12] hover:bg-[#f3b26c]"
              : "cursor-not-allowed border-white/12 bg-white/[0.06] text-white/55"
          )}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
