"use client";

import { XCircle } from "lucide-react";

interface ExitButtonProps {
  onClick: () => void;
}

export function ExitButton({ onClick }: ExitButtonProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-rose-200/80 bg-white/88 px-4 py-2 text-sm font-semibold text-rose-700 shadow-[0_18px_38px_-24px_rgba(244,63,94,0.45)] transition-all hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-rose-300/70 focus:ring-offset-0 active:scale-[0.98]"
      aria-label="Exit simulation immediately"
    >
      <XCircle className="h-4 w-4" />
      Exit Now
    </button>
  );
}
