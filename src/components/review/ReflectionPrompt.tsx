"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/reflection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: selectedTags,
          free_text: freeText || null,
        }),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        toast.error("Failed to save reflection. You can try again.");
      }
    } catch {
      toast.error("Failed to save reflection. You can try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm text-slate-500">Thanks for reflecting on this session.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-900">
          Encounters like this can be draining, even in simulation. How did this one feel?
        </p>
        <p className="mt-1 text-[12px] text-slate-400">
          This is not scored and is not part of your performance record.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TAGS.map((tag) => (
          <button
            key={tag.value}
            onClick={() => toggleTag(tag.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition-colors",
              selectedTags.includes(tag.value)
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            {tag.label}
          </button>
        ))}
      </div>

      <Textarea
        value={freeText}
        onChange={(e) => setFreeText(e.target.value)}
        placeholder="Anything else you'd like to note? (optional)"
        rows={2}
        className="text-sm"
      />

      <Button
        size="sm"
        variant="outline"
        onClick={handleSubmit}
        disabled={submitting || (selectedTags.length === 0 && !freeText.trim())}
      >
        {submitting ? "Saving..." : "Save reflection"}
      </Button>
    </div>
  );
}
