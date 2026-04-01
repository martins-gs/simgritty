import type {
  SimulationStateEvent,
  SimulationSession,
  TranscriptTurn,
  QualitativeLabel,
  ComposureMarker,
} from "@/types/simulation";
import type { ScoringWeights, ScenarioMilestone } from "@/types/scenario";
import { parseClinicianAudioPayload } from "@/lib/validation/schemas";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  overall: number;
  composure: number;
  deEscalation: number;
  clinicalTask: number | null;
  supportSeeking: number;
  qualitativeLabel: QualitativeLabel;
  weightsUsed: ScoringWeights;
  sessionValid: boolean;
  turnCount: number;
  summary: string;
  evidence: ScoreEvidence[];
}

export interface ScoreEvidence {
  dimension: string;
  turnIndex: number;
  evidenceType: string;
  evidenceData: Record<string, unknown>;
  scoreImpact: number;
}

export interface ScoringInput {
  session: SimulationSession;
  turns: TranscriptTurn[];
  events: SimulationStateEvent[];
  milestones: ScenarioMilestone[];
  weights: ScoringWeights | null;
  supportThreshold: number | null;
  criticalThreshold: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TURNS_FOR_SCORING = 6;
const PRELIMINARY_TURN_THRESHOLD = 12;
const SUPPORT_SEEKING_BASELINE = 70;
const SUPPORT_SEEKING_APPROPRIATE_BONUS = 15;
const SUPPORT_SEEKING_PREMATURE_PENALTY = 15;
const SUPPORT_SEEKING_CRITICAL_PENALTY_PER_TURN = 10;
const CRITICAL_GRACE_TURNS = 3;

// ---------------------------------------------------------------------------
// Qualitative label
// ---------------------------------------------------------------------------

function getQualitativeLabel(score: number): QualitativeLabel {
  if (score >= 80) return "Strong";
  if (score >= 60) return "Developing";
  return "Needs practice";
}

// ---------------------------------------------------------------------------
// Default weights
// ---------------------------------------------------------------------------

function getDefaultWeights(hasMilestones: boolean): ScoringWeights {
  if (hasMilestones) {
    return { composure: 0.25, de_escalation: 0.25, clinical_task: 0.25, support_seeking: 0.25 };
  }
  return { composure: 0.33, de_escalation: 0.34, clinical_task: 0, support_seeking: 0.33 };
}

function renormalizeWeights(weights: ScoringWeights, hasMilestones: boolean): ScoringWeights {
  if (hasMilestones) return weights;

  // Remove clinical_task weight and redistribute proportionally
  const remaining = weights.composure + weights.de_escalation + weights.support_seeking;
  if (remaining === 0) return getDefaultWeights(false);

  return {
    composure: weights.composure / remaining,
    de_escalation: weights.de_escalation / remaining,
    clinical_task: 0,
    support_seeking: weights.support_seeking / remaining,
  };
}

// ---------------------------------------------------------------------------
// Dimension 1: Composure
// ---------------------------------------------------------------------------

function computeComposure(
  traineeTurns: TranscriptTurn[],
  evidence: ScoreEvidence[]
): number {
  if (traineeTurns.length === 0) return 100;

  const penaltyPerTurn = 100 / (traineeTurns.length * 1.5);
  let totalPenalty = 0;

  for (const turn of traineeTurns) {
    const cr = turn.classifier_result;
    const markers: ComposureMarker[] = cr?.composure_markers ?? [];
    if (markers.length === 0) continue;

    // Multiple markers on same turn: 1.5x penalty (not doubled)
    const multiplier = markers.length > 1 ? 1.5 : 1;
    const turnPenalty = penaltyPerTurn * multiplier;
    totalPenalty += turnPenalty;

    evidence.push({
      dimension: "composure",
      turnIndex: turn.turn_index,
      evidenceType: "composure_marker",
      evidenceData: { markers },
      scoreImpact: -turnPenalty,
    });
  }

  return Math.max(0, Math.round(100 - totalPenalty));
}

// ---------------------------------------------------------------------------
// Dimension 2: De-escalation
// ---------------------------------------------------------------------------

function computeDeEscalation(
  traineeTurns: TranscriptTurn[],
  allTurns: TranscriptTurn[],
  evidence: ScoreEvidence[]
): number {
  // Determine baseline: level 1-2 means patient is calm, nothing to de-escalate
  const baselineLevel = 2;

  // Find scoreable turns (where escalation is above baseline)
  const scoreableTurns = traineeTurns.filter((t) => {
    const prevLevel = findLevelBeforeTurn(t.turn_index, allTurns);
    return prevLevel != null && prevLevel > baselineLevel;
  });

  const opportunities = scoreableTurns.length;

  if (opportunities === 0) return 100; // Nothing to de-escalate

  let attemptsMade = 0;
  let effectiveAttempts = 0;

  for (const turn of scoreableTurns) {
    const cr = turn.classifier_result;
    if (!cr?.de_escalation_attempt) continue;

    attemptsMade++;

    // Measure effectiveness: did escalation decrease after this attempt?
    const levelBefore = findLevelBeforeTurn(turn.turn_index, allTurns);
    const levelAfterNext = findLevelAfterNextPatientTurn(turn.turn_index, allTurns);

    if (levelBefore != null && levelAfterNext != null && levelAfterNext < levelBefore) {
      effectiveAttempts++;
      evidence.push({
        dimension: "de_escalation",
        turnIndex: turn.turn_index,
        evidenceType: "de_escalation_attempt",
        evidenceData: {
          technique: cr.de_escalation_technique,
          effective: true,
          levelBefore,
          levelAfter: levelAfterNext,
        },
        scoreImpact: 0, // Calculated in aggregate
      });
    } else {
      evidence.push({
        dimension: "de_escalation",
        turnIndex: turn.turn_index,
        evidenceType: "de_escalation_attempt",
        evidenceData: {
          technique: cr.de_escalation_technique,
          effective: false,
          levelBefore,
          levelAfter: levelAfterNext,
        },
        scoreImpact: 0,
      });
    }
  }

  if (attemptsMade === 0) return 0; // Never tried

  const attemptRate = attemptsMade / opportunities;
  const successRate = effectiveAttempts / attemptsMade;
  return Math.round((attemptRate * 0.4 + successRate * 0.6) * 100);
}

/** Find the escalation level before a given trainee turn. */
function findLevelBeforeTurn(
  turnIndex: number,
  allTurns: TranscriptTurn[]
): number | null {
  // Look at the turn immediately before this one (any speaker)
  // and use its state_after.level
  for (let i = allTurns.length - 1; i >= 0; i--) {
    if (allTurns[i].turn_index < turnIndex && allTurns[i].state_after) {
      return allTurns[i].state_after!.level;
    }
  }
  return null;
}

/** Find the escalation level after the next patient turn following this trainee turn. */
function findLevelAfterNextPatientTurn(
  turnIndex: number,
  allTurns: TranscriptTurn[]
): number | null {
  // Look for the next "ai" (patient) turn after this turn
  for (const turn of allTurns) {
    if (turn.turn_index > turnIndex && turn.speaker === "ai" && turn.state_after) {
      return turn.state_after.level;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dimension 3: Clinical Task Maintenance
// ---------------------------------------------------------------------------

function computeClinicalTask(
  traineeTurns: TranscriptTurn[],
  milestones: ScenarioMilestone[],
  evidence: ScoreEvidence[]
): number | null {
  if (milestones.length === 0) return null;

  const completedIds = new Set<string>();

  for (const turn of traineeTurns) {
    const cr = turn.classifier_result;
    const milestoneId = cr?.clinical_milestone_completed;
    if (!milestoneId) continue;
    // Validate this is an actual milestone ID
    if (!milestones.some((m) => m.id === milestoneId)) continue;
    if (completedIds.has(milestoneId)) continue; // Already completed

    completedIds.add(milestoneId);
    const milestone = milestones.find((m) => m.id === milestoneId);
    evidence.push({
      dimension: "clinical_task",
      turnIndex: turn.turn_index,
      evidenceType: "milestone_completed",
      evidenceData: {
        milestoneId,
        description: milestone?.description,
      },
      scoreImpact: 0, // Calculated in aggregate
    });
  }

  return Math.round((completedIds.size / milestones.length) * 100);
}

// ---------------------------------------------------------------------------
// Dimension 4: Support Seeking
// ---------------------------------------------------------------------------

function computeSupportSeeking(
  turns: TranscriptTurn[],
  events: SimulationStateEvent[],
  supportThreshold: number | null,
  criticalThreshold: number | null,
  evidence: ScoreEvidence[]
): number {
  if (supportThreshold == null) return SUPPORT_SEEKING_BASELINE;

  let score = SUPPORT_SEEKING_BASELINE;

  // Find bot clinician invocations — "system" speaker turns are clinician turns
  const botInvocations: { turnIndex: number; escalationLevel: number }[] = [];
  for (const turn of turns) {
    if (turn.speaker === "system") {
      // Find the escalation level at the time of invocation
      const level = findLevelBeforeTurn(turn.turn_index, turns);
      if (level != null) {
        botInvocations.push({ turnIndex: turn.turn_index, escalationLevel: level });
      }
    }
  }

  // Also check clinician_audio events for bot invocations
  for (const event of events) {
    if (event.event_type === "clinician_audio") {
      const payload = parseClinicianAudioPayload(event.payload);
      if (payload) {
        // Only add if not already tracked via turns
        const alreadyTracked = botInvocations.some(
          (b) => b.turnIndex === payload.turn_index
        );
        if (!alreadyTracked) {
          const level = event.escalation_before ?? event.escalation_after;
          if (level != null) {
            botInvocations.push({ turnIndex: payload.turn_index, escalationLevel: level });
          }
        }
      }
    }
  }

  // Score each invocation
  for (const invocation of botInvocations) {
    if (invocation.escalationLevel < supportThreshold) {
      // Premature
      score -= SUPPORT_SEEKING_PREMATURE_PENALTY;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: invocation.turnIndex,
        evidenceType: "support_invoked",
        evidenceData: {
          escalationLevel: invocation.escalationLevel,
          threshold: supportThreshold,
          appropriate: false,
        },
        scoreImpact: -SUPPORT_SEEKING_PREMATURE_PENALTY,
      });
    } else {
      // Appropriate
      score += SUPPORT_SEEKING_APPROPRIATE_BONUS;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: invocation.turnIndex,
        evidenceType: "support_invoked",
        evidenceData: {
          escalationLevel: invocation.escalationLevel,
          threshold: supportThreshold,
          appropriate: true,
        },
        scoreImpact: SUPPORT_SEEKING_APPROPRIATE_BONUS,
      });
    }
  }

  // Penalty for sustained critical escalation without help-seeking
  if (criticalThreshold != null) {
    let consecutiveCritical = 0;
    let lastBotTurnIndex = -1;

    for (const invocation of botInvocations) {
      if (invocation.turnIndex > lastBotTurnIndex) {
        lastBotTurnIndex = invocation.turnIndex;
      }
    }

    for (const turn of turns) {
      if (turn.turn_index <= lastBotTurnIndex) continue;
      const level = turn.state_after?.level;
      if (level != null && level >= criticalThreshold) {
        consecutiveCritical++;
        if (consecutiveCritical > CRITICAL_GRACE_TURNS) {
          score -= SUPPORT_SEEKING_CRITICAL_PENALTY_PER_TURN;
          evidence.push({
            dimension: "support_seeking",
            turnIndex: turn.turn_index,
            evidenceType: "critical_no_support",
            evidenceData: {
              escalationLevel: level,
              criticalThreshold,
              consecutiveTurns: consecutiveCritical,
            },
            scoreImpact: -SUPPORT_SEEKING_CRITICAL_PENALTY_PER_TURN,
          });
        }
      } else {
        consecutiveCritical = 0;
      }
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

function getSummary(
  composure: number,
  deEscalation: number,
  clinicalTask: number | null,
  supportSeeking: number,
  weightsUsed: ScoringWeights
): string {
  const parts: string[] = [];

  // Find the strongest and weakest scored dimensions
  const dims: { name: string; score: number; weight: number }[] = [
    { name: "Composure", score: composure, weight: weightsUsed.composure },
    { name: "De-escalation", score: deEscalation, weight: weightsUsed.de_escalation },
    { name: "Support seeking", score: supportSeeking, weight: weightsUsed.support_seeking },
  ];
  if (clinicalTask != null) {
    dims.push({ name: "Clinical task", score: clinicalTask, weight: weightsUsed.clinical_task });
  }

  const sorted = [...dims].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];

  if (strongest.score >= 80) {
    parts.push(`Strong ${strongest.name.toLowerCase()}`);
  } else if (strongest.score >= 60) {
    parts.push(`Developing ${strongest.name.toLowerCase()}`);
  }

  if (weakest.score < 60 && weakest !== strongest) {
    parts.push(`${weakest.name.toLowerCase()} needs practice`);
  }

  if (parts.length === 0) {
    parts.push("Balanced performance across dimensions");
  }

  return parts.join("; ") + ".";
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function computeScore(input: ScoringInput): ScoreBreakdown {
  const { session, turns, events, milestones, weights, supportThreshold, criticalThreshold } = input;

  const turnCount = turns.length;
  const sessionValid = turnCount >= MIN_TURNS_FOR_SCORING;
  const hasMilestones = milestones.length > 0;

  // Resolve weights
  const rawWeights = weights ?? getDefaultWeights(hasMilestones);
  const weightsUsed = renormalizeWeights(rawWeights, hasMilestones);

  // If session is too short, return zeroed scores
  if (!sessionValid) {
    return {
      overall: 0,
      composure: 0,
      deEscalation: 0,
      clinicalTask: hasMilestones ? 0 : null,
      supportSeeking: 0,
      qualitativeLabel: "Needs practice",
      weightsUsed,
      sessionValid: false,
      turnCount,
      summary: "This session ended before enough interaction occurred to generate a score.",
      evidence: [],
    };
  }

  const evidence: ScoreEvidence[] = [];

  // All turns (all speakers) needed for level lookups
  const allTurns = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const traineeTurns = allTurns.filter((t) => t.speaker === "trainee");

  // Compute each dimension
  const composure = computeComposure(traineeTurns, evidence);
  const deEscalation = computeDeEscalation(traineeTurns, allTurns, evidence);
  const clinicalTask = computeClinicalTask(traineeTurns, milestones, evidence);
  const supportSeeking = computeSupportSeeking(
    allTurns, events, supportThreshold, criticalThreshold, evidence
  );

  // Weighted overall
  let overall =
    composure * weightsUsed.composure +
    deEscalation * weightsUsed.de_escalation +
    supportSeeking * weightsUsed.support_seeking;

  if (clinicalTask != null) {
    overall += clinicalTask * weightsUsed.clinical_task;
  }

  overall = Math.max(0, Math.min(100, Math.round(overall)));

  return {
    overall,
    composure,
    deEscalation,
    clinicalTask,
    supportSeeking,
    qualitativeLabel: getQualitativeLabel(overall),
    weightsUsed,
    sessionValid,
    turnCount,
    summary: getSummary(composure, deEscalation, clinicalTask, supportSeeking, weightsUsed),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Helpers for review page
// ---------------------------------------------------------------------------

/** Whether the session is in the "preliminary" range (6-12 turns). */
export function isSessionPreliminary(turnCount: number): boolean {
  return turnCount >= MIN_TURNS_FOR_SCORING && turnCount <= PRELIMINARY_TURN_THRESHOLD;
}

/** Pick the 2-3 highest-impact evidence items for "key moments" display. */
export function pickKeyMoments(evidence: ScoreEvidence[], maxCount = 3): ScoreEvidence[] {
  return [...evidence]
    .sort((a, b) => Math.abs(b.scoreImpact) - Math.abs(a.scoreImpact))
    .slice(0, maxCount);
}

/** Get a technique suggestion based on the weakest dimension. */
export function getNextTimeTrySuggestion(score: ScoreBreakdown): string | null {
  if (!score.sessionValid) return null;

  const dims: { key: string; score: number }[] = [
    { key: "composure", score: score.composure },
    { key: "deEscalation", score: score.deEscalation },
    { key: "supportSeeking", score: score.supportSeeking },
  ];
  if (score.clinicalTask != null) {
    dims.push({ key: "clinicalTask", score: score.clinicalTask });
  }

  const weakest = dims.reduce((min, d) => (d.score < min.score ? d : min));

  const suggestions: Record<string, string> = {
    composure:
      "Try pausing before responding when you feel defensive. A brief moment of silence can help you choose a measured response rather than a reactive one.",
    deEscalation:
      "When someone is escalating, try naming what you observe: \"I can see this is really frustrating for you.\" Validation doesn't mean agreement — it shows you're listening.",
    clinicalTask:
      "Under pressure, it's easy to focus entirely on the interpersonal conflict and lose sight of the clinical task. Try mentally separating the two: acknowledge the emotion, then return to the clinical need.",
    supportSeeking:
      "Consider whether the situation has escalated beyond what you can manage alone. Calling for support isn't a failure — it's a professional judgment that protects both you and the patient.",
  };

  return suggestions[weakest.key] ?? null;
}
