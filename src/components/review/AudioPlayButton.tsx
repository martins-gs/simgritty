"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface AudioPlayButtonProps {
  audioUrl: string;
  startOffset: number;
  endOffset: number;
  /** Optional className for the outer button */
  className?: string;
}

export function AudioPlayButton({
  audioUrl,
  startOffset,
  endOffset,
  className,
}: AudioPlayButtonProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  const togglePlayback = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // don't trigger turn selection

      if (playing) {
        if (endTimerRef.current) clearTimeout(endTimerRef.current);
        audioRef.current?.pause();
        setPlaying(false);
        return;
      }

      if (!audioRef.current) {
        audioRef.current = new Audio(audioUrl);
        audioRef.current.addEventListener("ended", () => setPlaying(false));
        audioRef.current.addEventListener("error", () => setPlaying(false));
      }

      const audio = audioRef.current;
      audio.currentTime = Math.max(0, startOffset);
      audio.play().then(() => {
        setPlaying(true);
        // Schedule stop at end offset
        const duration = Math.max(0, endOffset - startOffset);
        if (duration > 0 && Number.isFinite(duration)) {
          endTimerRef.current = setTimeout(() => {
            audio.pause();
            setPlaying(false);
          }, duration * 1000);
        }
      }).catch(() => {
        setPlaying(false);
      });
    },
    [audioUrl, startOffset, endOffset, playing]
  );

  return (
    <button
      type="button"
      onClick={togglePlayback}
      className={cn(
        "inline-flex items-center justify-center rounded-full w-6 h-6",
        "bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
        playing && "bg-blue-100 text-blue-600 hover:bg-blue-200",
        className
      )}
      title={playing ? "Pause audio" : "Play audio"}
    >
      {playing ? (
        <Pause className="h-3 w-3" />
      ) : (
        <Play className="h-3 w-3 ml-0.5" />
      )}
    </button>
  );
}
