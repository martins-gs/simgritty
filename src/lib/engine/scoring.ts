import type { SimulationStateEvent, SimulationSession } from "@/types/simulation";

export interface ScoreBreakdown {
  /** Overall score 0-100 */
  overall: number;
  /** De-escalation effectiveness (0-40 points) */
  deescalation: number;
  /** Speed of resolution (0-25 points) */
  speed: number;
  /** Independence — not relying on AI clinician (0-25 points) */
  independence: number;
  /** Stability — avoided wild swings (0-10 points) */
  stability: number;
  /** Letter grade */
  grade: string;
  /** Short summary of performance */
  summary: string;
}

interface ScoringInput {
  session: SimulationSession;
  events: SimulationStateEvent[];
  initialLevel: number;
  botTurnCount: number;
  traineeTurnCount: number;
}

function getGrade(score: number): string {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

function getSummary(breakdown: Omit<ScoreBreakdown, "summary" | "grade">): string {
  const parts: string[] = [];

  if (breakdown.deescalation >= 30) {
    parts.push("Excellent de-escalation");
  } else if (breakdown.deescalation >= 20) {
    parts.push("Good de-escalation progress");
  } else if (breakdown.deescalation >= 10) {
    parts.push("Some de-escalation achieved");
  } else {
    parts.push("Limited de-escalation");
  }

  if (breakdown.independence >= 20) {
    parts.push("handled independently");
  } else if (breakdown.independence >= 10) {
    parts.push("with some AI assistance");
  } else {
    parts.push("heavily reliant on AI clinician");
  }

  if (breakdown.speed >= 20) {
    parts.push("resolved quickly");
  } else if (breakdown.speed < 10) {
    parts.push("slow to resolve");
  }

  return parts.join(", ") + ".";
}

export function computeScore(input: ScoringInput): ScoreBreakdown {
  const { session, events, initialLevel, botTurnCount, traineeTurnCount } = input;

  const peakLevel = session.peak_escalation_level ?? initialLevel;
  const finalLevel = session.final_escalation_level ?? peakLevel;
  const exitType = session.exit_type;

  // ── De-escalation score (0-40) ──
  // Based on how much level was reduced relative to the peak
  let deescalation = 0;
  const peakDrop = peakLevel - finalLevel;
  const totalRange = peakLevel - 1; // max possible drop (to level 1)

  if (totalRange > 0) {
    const dropRatio = peakDrop / totalRange;
    deescalation = Math.round(dropRatio * 30);
  }

  // Bonus for reaching low levels
  if (finalLevel <= 2) deescalation += 10;
  else if (finalLevel <= 3) deescalation += 5;
  else if (finalLevel <= 4) deescalation += 2;

  // Penalty for reaching ceiling or instant exit
  if (exitType === "auto_ceiling") deescalation = Math.max(0, deescalation - 15);
  if (exitType === "instant_exit") deescalation = Math.max(0, deescalation - 10);

  deescalation = Math.min(40, Math.max(0, deescalation));

  // ── Speed score (0-25) ──
  // Faster de-escalation is better. Based on how many turns it took to resolve
  // relative to the peak level (higher peaks reasonably take more turns).
  let speed = 0;
  const totalTurns = traineeTurnCount + botTurnCount;

  if (totalTurns > 0 && peakDrop > 0) {
    const turnsPerLevelDrop = totalTurns / peakDrop;
    // Ideal: ~2 turns per level drop
    if (turnsPerLevelDrop <= 2) speed = 25;
    else if (turnsPerLevelDrop <= 3) speed = 20;
    else if (turnsPerLevelDrop <= 4) speed = 15;
    else if (turnsPerLevelDrop <= 6) speed = 10;
    else speed = 5;
  } else if (peakDrop === 0 && finalLevel <= initialLevel) {
    // Maintained level without escalation — partial credit
    speed = 10;
  }

  // Penalty for very long sessions (>30 turns)
  if (totalTurns > 30) speed = Math.max(0, speed - 5);
  if (totalTurns > 50) speed = Math.max(0, speed - 5);

  speed = Math.min(25, Math.max(0, speed));

  // ── Independence score (0-25) ──
  // Full marks for no bot usage, scaled down based on bot turn ratio
  let independence = 25;
  if (totalTurns > 0) {
    const botRatio = botTurnCount / totalTurns;
    if (botRatio === 0) {
      independence = 25;
    } else if (botRatio <= 0.15) {
      independence = 20;
    } else if (botRatio <= 0.3) {
      independence = 15;
    } else if (botRatio <= 0.5) {
      independence = 10;
    } else {
      independence = 5;
    }
  }

  // If the bot did ALL the de-escalation (trainee never brought it down), penalise further
  const traineeDeescalationEvents = events.filter(
    (e) => e.event_type === "de_escalation_change" && !isClinicianEvent(e)
  ).length;
  const totalDeescalationEvents = events.filter(
    (e) => e.event_type === "de_escalation_change"
  ).length;

  if (totalDeescalationEvents > 0 && traineeDeescalationEvents === 0) {
    independence = Math.max(0, independence - 10);
  }

  independence = Math.min(25, Math.max(0, independence));

  // ── Stability score (0-10) ──
  // Reward steady trajectories, penalise wild swings
  let stability = 10;
  const levelChanges = events
    .filter((e) => e.escalation_before !== null && e.escalation_after !== null)
    .map((e) => Math.abs(e.escalation_after! - e.escalation_before!));

  const bigSwings = levelChanges.filter((c) => c >= 2).length;
  stability = Math.max(0, stability - bigSwings * 2);

  // Penalise re-escalation after de-escalation started
  let sawDeesc = false;
  let reescalations = 0;
  for (const event of events) {
    if (event.event_type === "de_escalation_change") sawDeesc = true;
    if (sawDeesc && event.event_type === "escalation_change") reescalations++;
  }
  stability = Math.max(0, stability - reescalations * 2);

  stability = Math.min(10, Math.max(0, stability));

  const overall = Math.min(100, deescalation + speed + independence + stability);

  const partial = { overall, deescalation, speed, independence, stability };

  return {
    ...partial,
    grade: getGrade(overall),
    summary: getSummary(partial),
  };
}

function isClinicianEvent(event: SimulationStateEvent): boolean {
  const payload = event.payload as { delta?: { source?: string }; classifier?: { source?: string } } | null;
  return payload?.delta?.source === "clinician" || payload?.classifier?.source === "clinician";
}
