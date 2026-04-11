export const DEFAULT_TURN_SILENCE_DURATION_MS = 320;
export const MIN_TURN_PAUSE_ALLOWANCE_MS = 0;
export const MAX_TURN_PAUSE_ALLOWANCE_MS = 1500;
export const TURN_PAUSE_ALLOWANCE_STEP_MS = 50;

const BASE_TURN_DETECTION = {
  type: "server_vad" as const,
  threshold: 0.55,
  prefix_padding_ms: 300,
  interrupt_response: false,
  create_response: true,
};

export function clampTurnPauseAllowanceMs(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return MIN_TURN_PAUSE_ALLOWANCE_MS;
  }

  const rounded = Math.round(value as number);
  return Math.min(
    MAX_TURN_PAUSE_ALLOWANCE_MS,
    Math.max(MIN_TURN_PAUSE_ALLOWANCE_MS, rounded)
  );
}

export function getTurnSilenceDurationMs(extraPauseAllowanceMs: number | null | undefined): number {
  return DEFAULT_TURN_SILENCE_DURATION_MS + clampTurnPauseAllowanceMs(extraPauseAllowanceMs);
}

export function createTurnDetection(extraPauseAllowanceMs: number | null | undefined = 0) {
  return {
    ...BASE_TURN_DETECTION,
    silence_duration_ms: getTurnSilenceDurationMs(extraPauseAllowanceMs),
  };
}
