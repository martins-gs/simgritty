import type {
  SimulationStateEvent,
  SimulationSession,
  TranscriptTurn,
  QualitativeLabel,
  ComposureMarker,
  TraineeDeliveryAnalysis,
  TraineeDeliveryMarker,
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

const MIN_TRAINEE_TURNS_FOR_SCORING = 3;
const PRELIMINARY_TRAINEE_TURN_THRESHOLD = 6;
const COMPOSURE_MARKER_WEIGHTS: Record<ComposureMarker, number> = {
  defensive_language: 10,
  dismissive_response: 14,
  hostility_mirroring: 18,
  sarcasm: 12,
  interruption: 8,
};
const COMPOSURE_REPEAT_MARKER_PENALTY = 3;
const COMPOSURE_MULTI_MARKER_MULTIPLIER = 1.1;
const AUDIO_DELIVERY_CONFIDENCE_THRESHOLD = 0.45;
const DE_ESCALATION_HARM_PENALTY_FACTOR = 20;
const SUPPORT_SEEKING_START_SCORE = 100;
const SUPPORT_SEEKING_APPROPRIATE_BONUS = 10;
const SUPPORT_SEEKING_PREMATURE_PENALTY = 20;
const SUPPORT_SEEKING_MISSED_OPPORTUNITY_PENALTY = 20;
const SUPPORT_SEEKING_CRITICAL_DELAY_PENALTY = 15;
const SUPPORT_SEEKING_CRISIS_PENALTY = 25;
const CRISIS_LEVEL = 10;
const COMPOSURE_DELIVERY_MARKER_SCORE_DELTAS: Record<TraineeDeliveryMarker, number> = {
  calm_measured: 3,
  warm_empathic: 4,
  tense_hurried: -4,
  flat_detached: -3,
  defensive_tone: -6,
  sarcastic_tone: -8,
  irritated_tone: -7,
  hostile_tone: -12,
  anxious_unsteady: -4,
};
const DE_ESCALATION_DELIVERY_MARKER_SCORE_DELTAS: Record<TraineeDeliveryMarker, number> = {
  calm_measured: 4,
  warm_empathic: 5,
  tense_hurried: -4,
  flat_detached: -3,
  defensive_tone: -6,
  sarcastic_tone: -8,
  irritated_tone: -7,
  hostile_tone: -10,
  anxious_unsteady: -5,
};

interface SupportEpisode {
  startTurnIndex: number;
  endTurnIndex: number;
  escalationLevel: number;
}

interface DeliveryScoreDelta {
  delta: number;
  markers: TraineeDeliveryMarker[];
}

function getTurnDeliveryAnalysis(turn: TranscriptTurn): TraineeDeliveryAnalysis | null {
  return turn.trainee_delivery_analysis ?? turn.classifier_result?.trainee_delivery_analysis ?? null;
}

function getDeliveryScoreDelta(
  analysis: TraineeDeliveryAnalysis | null | undefined,
  markerScoreDeltas: Record<TraineeDeliveryMarker, number>,
  options: {
    allowPositive?: boolean;
    allowNegative?: boolean;
  } = {}
): DeliveryScoreDelta | null {
  if (
    !analysis ||
    analysis.source !== "audio" ||
    analysis.confidence < AUDIO_DELIVERY_CONFIDENCE_THRESHOLD
  ) {
    return null;
  }

  const allowPositive = options.allowPositive ?? true;
  const allowNegative = options.allowNegative ?? true;
  const uniqueMarkers = [...new Set(analysis.markers)];
  const scoredMarkers: TraineeDeliveryMarker[] = [];
  let rawDelta = 0;

  for (const marker of uniqueMarkers) {
    const markerDelta = markerScoreDeltas[marker] ?? 0;
    if (markerDelta === 0) continue;
    if (markerDelta > 0 && !allowPositive) continue;
    if (markerDelta < 0 && !allowNegative) continue;

    rawDelta += markerDelta;
    scoredMarkers.push(marker);
  }

  if (rawDelta === 0 || scoredMarkers.length === 0) {
    return null;
  }

  const scaledDelta = Math.round(rawDelta * analysis.confidence);
  if (scaledDelta === 0) {
    return null;
  }

  return {
    delta: scaledDelta,
    markers: scoredMarkers,
  };
}

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
  allTurns: TranscriptTurn[],
  evidence: ScoreEvidence[]
): number {
  if (traineeTurns.length === 0) return 100;

  let totalPenalty = 0;
  let totalDeliveryDelta = 0;
  const seenMarkerCounts = new Map<ComposureMarker, number>();

  for (const turn of traineeTurns) {
    const cr = turn.classifier_result;
    const deliveryAnalysis = getTurnDeliveryAnalysis(turn);
    const markers: ComposureMarker[] = cr?.composure_markers ?? [];
    const levelBefore = findLevelBeforeTurn(turn.turn_index, allTurns);

    if (markers.length > 0) {
      let turnPenalty = 0;

      for (const marker of markers) {
        const seenCount = seenMarkerCounts.get(marker) ?? 0;
        turnPenalty += COMPOSURE_MARKER_WEIGHTS[marker] + seenCount * COMPOSURE_REPEAT_MARKER_PENALTY;
        seenMarkerCounts.set(marker, seenCount + 1);
      }

      if (markers.length > 1) {
        turnPenalty *= COMPOSURE_MULTI_MARKER_MULTIPLIER;
      }

      if (levelBefore != null) {
        if (levelBefore >= 8) {
          turnPenalty *= 1.2;
        } else if (levelBefore >= 5) {
          turnPenalty *= 1.1;
        }
      }

      totalPenalty += turnPenalty;

      evidence.push({
        dimension: "composure",
        turnIndex: turn.turn_index,
        evidenceType: "composure_marker",
        evidenceData: { markers, levelBefore },
        scoreImpact: -turnPenalty,
      });
    }

    const deliveryDelta = getDeliveryScoreDelta(
      deliveryAnalysis,
      COMPOSURE_DELIVERY_MARKER_SCORE_DELTAS
    );
    if (!deliveryDelta) continue;

    totalDeliveryDelta += deliveryDelta.delta;
    evidence.push({
      dimension: "composure",
      turnIndex: turn.turn_index,
        evidenceType: "delivery_marker",
        evidenceData: {
          markers: deliveryDelta.markers,
          confidence: deliveryAnalysis?.confidence ?? null,
          summary: deliveryAnalysis?.summary ?? null,
          source: deliveryAnalysis?.source ?? null,
        },
        scoreImpact: deliveryDelta.delta,
      });
  }

  return Math.max(0, Math.min(100, Math.round(100 - totalPenalty + totalDeliveryDelta)));
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
  let harmPenalty = 0;
  let deliveryDelta = 0;

  for (const turn of scoreableTurns) {
    const cr = turn.classifier_result;
    const deliveryAnalysis = getTurnDeliveryAnalysis(turn);
    const levelBefore = findLevelBeforeTurn(turn.turn_index, allTurns);
    const turnDeliveryDelta = getDeliveryScoreDelta(
      deliveryAnalysis,
      DE_ESCALATION_DELIVERY_MARKER_SCORE_DELTAS,
      {
        allowPositive: Boolean(cr?.de_escalation_attempt),
        allowNegative: true,
      }
    );

    if (turnDeliveryDelta) {
      deliveryDelta += turnDeliveryDelta.delta;
      evidence.push({
        dimension: "de_escalation",
        turnIndex: turn.turn_index,
        evidenceType: "delivery_marker",
        evidenceData: {
          markers: turnDeliveryDelta.markers,
          confidence: deliveryAnalysis?.confidence ?? null,
          summary: deliveryAnalysis?.summary ?? null,
          source: deliveryAnalysis?.source ?? null,
          pairedWithAttempt: Boolean(cr?.de_escalation_attempt),
          levelBefore,
        },
        scoreImpact: turnDeliveryDelta.delta,
      });
    }

    if (cr?.effectiveness != null && cr.effectiveness < 0) {
      const turnPenalty = Math.abs(cr.effectiveness) * DE_ESCALATION_HARM_PENALTY_FACTOR;
      harmPenalty += turnPenalty;
      evidence.push({
        dimension: "de_escalation",
        turnIndex: turn.turn_index,
        evidenceType: "de_escalation_harm",
        evidenceData: {
          technique: cr.technique,
          effectiveness: cr.effectiveness,
          levelBefore,
        },
        scoreImpact: -turnPenalty,
      });
    }

    if (!cr?.de_escalation_attempt) continue;

    attemptsMade++;

    // Measure effectiveness: did escalation decrease after this attempt?
    const { levelAfterNextPatientTurn, clinicianIntervened } = findNextPatientOutcomeAfterTurn(
      turn.turn_index,
      allTurns
    );
    const effective =
      !clinicianIntervened &&
      levelBefore != null &&
      levelAfterNextPatientTurn != null &&
      levelAfterNextPatientTurn < levelBefore;

    if (effective) {
      effectiveAttempts++;
      evidence.push({
        dimension: "de_escalation",
        turnIndex: turn.turn_index,
        evidenceType: "de_escalation_attempt",
        evidenceData: {
          technique: cr.de_escalation_technique,
          effective: true,
          levelBefore,
          levelAfter: levelAfterNextPatientTurn,
          clinicianIntervened,
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
          levelAfter: levelAfterNextPatientTurn,
          clinicianIntervened,
        },
        scoreImpact: 0,
      });
    }
  }

  if (attemptsMade === 0) return 0; // Never tried

  const attemptRate = attemptsMade / opportunities;
  const successRate = effectiveAttempts / attemptsMade;
  const rawScore = (attemptRate * 0.4 + successRate * 0.6) * 100;
  return Math.max(0, Math.min(100, Math.round(rawScore - harmPenalty + deliveryDelta)));
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
function findNextPatientOutcomeAfterTurn(
  turnIndex: number,
  allTurns: TranscriptTurn[]
): { levelAfterNextPatientTurn: number | null; clinicianIntervened: boolean } {
  let clinicianIntervened = false;

  // Look for the next patient turn after this turn and track whether the AI
  // clinician intervened before that reply. If the clinician steps in first,
  // any recovery should not be credited to the trainee's last attempt.
  for (const turn of allTurns) {
    if (turn.turn_index <= turnIndex) continue;
    if (turn.speaker === "system") {
      clinicianIntervened = true;
      continue;
    }
    if (turn.speaker === "ai" && turn.state_after) {
      return {
        levelAfterNextPatientTurn: turn.state_after.level,
        clinicianIntervened,
      };
    }
  }
  return { levelAfterNextPatientTurn: null, clinicianIntervened };
}

function findPreviousNonAiSpeaker(
  turnIndex: number,
  allTurns: TranscriptTurn[]
): TranscriptTurn["speaker"] | null {
  for (let i = allTurns.length - 1; i >= 0; i--) {
    const turn = allTurns[i];
    if (turn.turn_index >= turnIndex) continue;
    if (turn.speaker === "ai") continue;
    return turn.speaker;
  }
  return null;
}

function collectSupportEpisodes(
  turns: TranscriptTurn[],
  events: SimulationStateEvent[]
): SupportEpisode[] {
  const sortedTurns = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const episodes: SupportEpisode[] = [];
  let activeEpisode: Omit<SupportEpisode, "endTurnIndex"> | null = null;
  let lastSeenTurnIndex = -1;

  for (const turn of sortedTurns) {
    if (turn.speaker === "trainee" && activeEpisode) {
      episodes.push({ ...activeEpisode, endTurnIndex: lastSeenTurnIndex });
      activeEpisode = null;
    }

    if (turn.speaker === "system") {
      const previousNonAiSpeaker = findPreviousNonAiSpeaker(turn.turn_index, sortedTurns);
      const isEpisodeStart = previousNonAiSpeaker == null || previousNonAiSpeaker === "trainee";
      if (isEpisodeStart) {
        const escalationLevel = findLevelBeforeTurn(turn.turn_index, sortedTurns);
        if (escalationLevel != null) {
          activeEpisode = {
            startTurnIndex: turn.turn_index,
            escalationLevel,
          };
        }
      }
    }

    lastSeenTurnIndex = turn.turn_index;
  }

  if (activeEpisode) {
    episodes.push({ ...activeEpisode, endTurnIndex: lastSeenTurnIndex });
  }

  if (episodes.length > 0) {
    return episodes;
  }

  const fallbackEpisodes = new Map<number, SupportEpisode>();
  for (const event of events) {
    if (event.event_type !== "clinician_audio") continue;
    const payload = parseClinicianAudioPayload(event.payload);
    if (!payload) continue;

    const escalationLevel = event.escalation_before ?? event.escalation_after;
    if (escalationLevel == null) continue;

    fallbackEpisodes.set(payload.turn_index, {
      startTurnIndex: payload.turn_index,
      endTurnIndex: payload.turn_index,
      escalationLevel,
    });
  }

  return [...fallbackEpisodes.values()].sort((a, b) => a.startTurnIndex - b.startTurnIndex);
}

function isTurnCoveredBySupportEpisode(
  turnIndex: number,
  episodes: SupportEpisode[]
): boolean {
  return episodes.some((episode) => (
    turnIndex >= episode.startTurnIndex && turnIndex <= episode.endTurnIndex
  ));
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
  // Legacy scenarios may not define a support threshold. Fall back to the
  // critical threshold or a pragmatic default so support seeking is still
  // scored from real missed opportunities rather than a neutral placeholder.
  const effectiveSupportThreshold = supportThreshold ?? criticalThreshold ?? 6;

  let score = SUPPORT_SEEKING_START_SCORE;
  const supportEpisodes = collectSupportEpisodes(turns, events);
  const sortedTurns = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const traineeTurns = sortedTurns.filter((turn) => turn.speaker === "trainee");
  let firstMissedOpportunityTurnIndex: number | null = null;
  let highestMissedOpportunityLevel = 0;

  // Score each explicit support request.
  for (const episode of supportEpisodes) {
    if (episode.escalationLevel < effectiveSupportThreshold) {
      score -= SUPPORT_SEEKING_PREMATURE_PENALTY;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: episode.startTurnIndex,
        evidenceType: "support_invoked",
        evidenceData: {
          escalationLevel: episode.escalationLevel,
          threshold: effectiveSupportThreshold,
          appropriate: false,
        },
        scoreImpact: -SUPPORT_SEEKING_PREMATURE_PENALTY,
      });
    } else {
      score += SUPPORT_SEEKING_APPROPRIATE_BONUS;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: episode.startTurnIndex,
        evidenceType: "support_invoked",
        evidenceData: {
          escalationLevel: episode.escalationLevel,
          threshold: effectiveSupportThreshold,
          appropriate: true,
        },
        scoreImpact: SUPPORT_SEEKING_APPROPRIATE_BONUS,
      });
    }
  }

  // Score missed opportunities from the trainee's actual decision points.
  for (const turn of traineeTurns) {
    const levelBefore = findLevelBeforeTurn(turn.turn_index, sortedTurns);
    if (levelBefore == null || levelBefore < effectiveSupportThreshold) {
      continue;
    }

    let turnPenalty = SUPPORT_SEEKING_MISSED_OPPORTUNITY_PENALTY;
    const criticalOpportunity = criticalThreshold != null && levelBefore >= criticalThreshold;
    if (criticalOpportunity) {
      turnPenalty += SUPPORT_SEEKING_CRITICAL_DELAY_PENALTY;
    }

    score -= turnPenalty;
    if (firstMissedOpportunityTurnIndex == null) {
      firstMissedOpportunityTurnIndex = turn.turn_index;
    }
    highestMissedOpportunityLevel = Math.max(highestMissedOpportunityLevel, levelBefore);

    evidence.push({
      dimension: "support_seeking",
      turnIndex: turn.turn_index,
      evidenceType: criticalOpportunity ? "critical_no_support" : "support_not_requested",
      evidenceData: {
        escalationLevel: levelBefore,
        threshold: effectiveSupportThreshold,
        criticalThreshold,
        missedOpportunity: true,
      },
      scoreImpact: -turnPenalty,
    });
  }

  // If the trainee ignored an opportunity and the unsupported situation then worsened,
  // apply an additional severity penalty.
  if (firstMissedOpportunityTurnIndex != null) {
    const unsupportedTurnsAfterMiss = sortedTurns.filter((turn) => (
      turn.turn_index >= firstMissedOpportunityTurnIndex &&
      !isTurnCoveredBySupportEpisode(turn.turn_index, supportEpisodes) &&
      turn.state_after?.level != null
    ));

    const highestUnsupportedTurn = unsupportedTurnsAfterMiss.reduce<TranscriptTurn | null>((highest, turn) => {
      if (!turn.state_after) return highest;
      if (!highest?.state_after) return turn;
      return turn.state_after.level > highest.state_after.level ? turn : highest;
    }, null);

    const highestUnsupportedLevel = highestUnsupportedTurn?.state_after?.level ?? null;

    if (
      criticalThreshold != null &&
      highestUnsupportedLevel != null &&
      highestUnsupportedLevel >= criticalThreshold &&
      highestUnsupportedLevel > highestMissedOpportunityLevel
    ) {
      score -= SUPPORT_SEEKING_CRITICAL_DELAY_PENALTY;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: highestUnsupportedTurn!.turn_index,
        evidenceType: "critical_no_support",
        evidenceData: {
          escalationLevel: highestUnsupportedLevel,
          threshold: effectiveSupportThreshold,
          criticalThreshold,
          delayedEscalation: true,
        },
        scoreImpact: -SUPPORT_SEEKING_CRITICAL_DELAY_PENALTY,
      });
    }

    if (
      highestUnsupportedLevel != null &&
      highestUnsupportedLevel >= CRISIS_LEVEL &&
      highestUnsupportedLevel > highestMissedOpportunityLevel
    ) {
      score -= SUPPORT_SEEKING_CRISIS_PENALTY;
      evidence.push({
        dimension: "support_seeking",
        turnIndex: highestUnsupportedTurn!.turn_index,
        evidenceType: "critical_no_support",
        evidenceData: {
          escalationLevel: highestUnsupportedLevel,
          threshold: effectiveSupportThreshold,
          criticalThreshold,
          crisisReached: true,
        },
        scoreImpact: -SUPPORT_SEEKING_CRISIS_PENALTY,
      });
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
  const { turns, events, milestones, weights, supportThreshold, criticalThreshold } = input;

  const allTurns = [...turns].sort((a, b) => a.turn_index - b.turn_index);
  const traineeTurns = allTurns.filter((t) => t.speaker === "trainee");
  const turnCount = traineeTurns.length;
  const sessionValid = turnCount >= MIN_TRAINEE_TURNS_FOR_SCORING;
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
      summary: "This session ended before enough trainee interaction occurred to generate a score.",
      evidence: [],
    };
  }

  const evidence: ScoreEvidence[] = [];

  // Compute each dimension
  const composure = computeComposure(traineeTurns, allTurns, evidence);
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

/** Whether the session is in the "preliminary" range (6-12 trainee turns). */
export function isSessionPreliminary(turnCount: number): boolean {
  return (
    turnCount >= MIN_TRAINEE_TURNS_FOR_SCORING &&
    turnCount <= PRELIMINARY_TRAINEE_TURN_THRESHOLD
  );
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
