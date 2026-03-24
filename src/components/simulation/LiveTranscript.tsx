"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface TranscriptEntry {
  speaker: "trainee" | "ai" | "system";
  content: string;
  timestamp: string;
}

interface LiveTranscriptProps {
  entries: TranscriptEntry[];
  currentAiText: string;
}

export function LiveTranscript({ entries, currentAiText }: LiveTranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, currentAiText]);

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (entries.length === 0 && !currentAiText) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-[12px] text-slate-400 text-center">
          The transcript will appear here as the conversation progresses.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-1 p-3">
        {entries.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="py-1.5">
            <div className="flex items-baseline gap-2">
              <span className={cn(
                "shrink-0 text-[11px] font-medium",
                entry.speaker === "trainee" ? "text-primary" : "text-orange-600"
              )}>
                {entry.speaker === "trainee" ? "You" : "Patient"}
              </span>
              <span className="text-[10px] text-slate-300 tabular-nums">{formatTime(entry.timestamp)}</span>
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-700">
              {entry.content}
            </p>
          </div>
        ))}
        {currentAiText && (
          <div className="py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-[11px] font-medium text-orange-600">Patient</span>
              <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                live
              </span>
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-700">
              {currentAiText}
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
