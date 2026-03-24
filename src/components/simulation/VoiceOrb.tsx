"use client";

import { cn } from "@/lib/utils";

interface VoiceOrbProps {
  isActive: boolean;
  escalationLevel: number;
  isSpeaking: boolean;
}

function getOrbColor(level: number): string {
  if (level <= 2) return "from-emerald-400 via-teal-400 to-sky-500";
  if (level <= 4) return "from-amber-300 via-orange-300 to-amber-500";
  if (level <= 6) return "from-orange-400 via-orange-500 to-red-500";
  if (level <= 8) return "from-rose-400 via-red-500 to-red-700";
  return "from-red-500 via-red-700 to-red-950";
}

function getStatusText(isActive: boolean, isSpeaking: boolean) {
  if (!isActive) return { label: "Offline", sublabel: "Realtime session unavailable" };
  if (isSpeaking) return { label: "Speaking", sublabel: "Live response in progress" };
  return { label: "Listening", sublabel: "Awaiting the next turn" };
}

export function VoiceOrb({ isActive, escalationLevel, isSpeaking }: VoiceOrbProps) {
  const colorClass = getOrbColor(escalationLevel);
  const status = getStatusText(isActive, isSpeaking);

  return (
    <div className="flex items-center justify-center">
      <div className="relative flex aspect-square w-full max-w-[26rem] items-center justify-center">
        <div
          className={cn(
            "absolute inset-6 rounded-full bg-gradient-to-br opacity-45 blur-3xl transition-all duration-700",
            colorClass,
            isSpeaking && "scale-110 opacity-70"
          )}
        />
        <div className="absolute inset-0 rounded-full border border-white/60 bg-white/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-xl" />
        <div
          className={cn(
            "absolute inset-4 rounded-full border transition-all duration-500",
            isActive ? "border-white/60" : "border-slate-300/70",
            isSpeaking && "animate-pulse"
          )}
        />
        <div
          className={cn(
            "relative flex h-56 w-56 flex-col items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-950 text-white shadow-[0_40px_80px_-28px_rgba(15,23,42,0.65)] transition-all duration-500 md:h-64 md:w-64",
            isSpeaking && "scale-[1.04]"
          )}
        >
          <div
            className={cn(
              "absolute inset-3 rounded-full bg-gradient-to-br opacity-95",
              isActive ? colorClass : "from-slate-500 via-slate-600 to-slate-800"
            )}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.28),transparent_42%)]" />
          <div className="absolute inset-[18%] rounded-full border border-white/15" />

          <div className="relative z-10 flex flex-col items-center px-6 text-center">
            <span className="text-[11px] font-medium uppercase tracking-[0.38em] text-white/60">
              Patient Voice
            </span>
            <span className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              {status.label}
            </span>
            <span className="mt-2 text-sm text-white/72">
              {status.sublabel}
            </span>
            <div className="mt-5 rounded-full border border-white/15 bg-black/15 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.24em] text-white/82 backdrop-blur">
              Escalation {escalationLevel}/10
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
