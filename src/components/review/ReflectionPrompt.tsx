"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { parseSessionReflection } from "@/lib/validation/schemas";
import type { SessionReflection } from "@/types/simulation";

interface ReflectionPromptProps {
  sessionId: string;
}

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

      try {
        const res = await fetch(`/api/sessions/${sessionId}/reflection`);
        const payload = await res.json().catch(() => null);
        if (cancelled) return;

        if (!res.ok) {
          setErrorMessage(
            typeof payload?.error === "string"
              ? payload.error
              : "Unable to load saved reflection for this session."
          );
          setSavedReflection(null);
          return;
        }

        const reflection = parseSessionReflection(payload);
        setSavedReflection(reflection);
        setSelectedTags(reflection?.tags ?? []);
        setFreeText(reflection?.free_text ?? "");
      } catch {
        if (!cancelled) {
          setErrorMessage("Unable to load saved reflection for this session.");
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
    <div className="space-y-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5 shadow-sm ring-1 ring-amber-100/80">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-full border border-amber-300 bg-white/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-800">
            Reflection check-in
          </div>
          <div
            className={cn(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
              savedReflection
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-white/90 text-slate-600"
            )}
          >
            {savedReflection ? "Saved to this session" : "Not yet saved"}
          </div>
        </div>

        <div className="rounded-xl border border-white/80 bg-white/80 p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-900">
            Encounters like this can be draining, even in simulation. How did this one feel?
          </p>
          <p className="mt-2 text-[12px] leading-5 text-slate-600">
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
                ? "border-amber-400 bg-amber-100 text-amber-950 shadow-sm ring-1 ring-amber-200"
                : "border-amber-200 bg-white/90 text-slate-700 hover:border-amber-300 hover:bg-white"
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
        placeholder="Anything else you'd like to note? (optional)"
        rows={2}
        className="border-amber-200 bg-white/95 text-sm shadow-sm placeholder:text-slate-400 focus-visible:border-amber-400 focus-visible:ring-amber-200/60"
      />

      <div className="rounded-xl border border-amber-200/80 bg-white/85 p-4 shadow-sm">
        <p
          className={cn(
            "text-[12px] leading-5",
            errorMessage
              ? "text-red-600"
              : statusMessage || savedReflection
                ? "text-emerald-700"
                : "text-slate-500"
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
              ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              : "cursor-not-allowed border-amber-300 bg-white text-amber-900"
          )}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
