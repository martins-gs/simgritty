"use client";

import { useEffect } from "react";

/**
 * Suppresses the Supabase gotrue-js "Lock was stolen" AbortError that
 * surfaces as an unhandled rejection during page navigation.  This is
 * a known issue: when the user navigates (e.g. simulation → review),
 * the in-flight auth token refresh holds a Navigator Lock that is
 * orphaned when the originating component unmounts.  After 5 s gotrue
 * forcefully steals the lock, causing the original holder's promise
 * to reject with an AbortError.  The library recovers on its own —
 * the rejection is harmless but triggers the Next.js error overlay.
 */
export function SupabaseLockGuard() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const err = event.reason;
      if (
        err instanceof DOMException &&
        err.name === "AbortError" &&
        typeof err.message === "string" &&
        err.message.includes("stolen")
      ) {
        event.preventDefault();
      }
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }, []);

  return null;
}
