import type { EscalationState, EscalationDelta, TurnSource } from "@/types/escalation";
import type { ClassifierResult } from "@/types/simulation";
import type { ScenarioTraits, EscalationRules } from "@/types/scenario";
import { isDiscriminationActive } from "@/lib/engine/biasBehaviour";

export class EscalationEngine {
  private state: EscalationState;
  private rules: EscalationRules;
  private traits: ScenarioTraits;
  private orgCeiling: number;

  constructor(
    rules: EscalationRules,
    traits: ScenarioTraits,
    orgCeiling: number
  ) {
    this.rules = rules;
    this.traits = traits;
    this.orgCeiling = orgCeiling;
    this.state = {
      level: rules.initial_level,
      trust: traits.trust,
      willingness_to_listen: traits.willingness_to_listen,
      anger: Math.round((traits.hostility + traits.frustration) / 2),
      frustration: traits.frustration,
      boundary_respect: traits.boundary_respect,
      discrimination_active: false,
      interruptions_count: 0,
      validations_count: 0,
      unanswered_questions: 0,
    };
    this.syncDerivedFlags();
  }

  getState(): EscalationState {
    return { ...this.state };
  }

  hydrateState(state: EscalationState) {
    this.state = { ...state };
    this.syncDerivedFlags();
  }

  getLevel(): number {
    return this.state.level;
  }

  getEffectiveCeiling(): number {
    return Math.min(this.rules.max_ceiling, this.orgCeiling);
  }

  isAtCeiling(): boolean {
    return this.state.level >= this.getEffectiveCeiling();
  }

  shouldAutoEnd(): boolean {
    if (this.rules.auto_end_threshold === null) return false;
    return this.state.level >= this.rules.auto_end_threshold;
  }

  private syncDerivedFlags() {
    this.state.discrimination_active = isDiscriminationActive(this.traits, this.state);
  }

  processClassification(result: ClassifierResult, source: TurnSource = "trainee"): EscalationDelta {
    const effectiveness = result.effectiveness; // -1 to +1
    const volatilityFactor = this.traits.volatility / 10;
    const escalationTendency = this.traits.escalation_tendency / 10;
    const impatienceFactor = this.traits.impatience / 10;

    // Patient responses only track state — they don't move the level themselves.
    // The level already moved from the utterance that caused the response.
    if (source === "patient_response") {
      const reason = result.reasoning;
      // Track behaviour counts only
      if (result.tags.includes("validation") || result.tags.includes("empathy")) {
        this.state.validations_count++;
      }
      this.syncDerivedFlags();
      return {
        level_delta: 0,
        trust_delta: 0,
        listening_delta: 0,
        reason,
        trigger_type: "neutral",
      };
    }

    let levelDelta = 0;
    let trustDelta = 0;
    let listeningDelta = 0;
    const reason = result.reasoning;
    let triggerType: EscalationDelta["trigger_type"] = "neutral";

    // Narrower deadzone: ±0.15 instead of ±0.3
    // Already-escalated patients are more reactive (lower threshold)
    const escalationDeadzone = this.state.level >= 5 ? -0.1 : -0.15;
    const deescalationDeadzone = source === "clinician" ? 0.2 : 0.15;

    if (effectiveness < escalationDeadzone) {
      // --- Escalation trigger ---
      const rawDelta = Math.abs(effectiveness) * 2; // 0-2 range
      const amplified = rawDelta * (1 + volatilityFactor * 0.5);

      // Already-angry patients are MORE reactive to rudeness, not less
      const angerReactivity = 1 + (this.state.anger / 10) * 0.5; // 1.0-1.5x
      // Impatience makes the patient quicker to escalate
      const impatienceBoost = 1 + impatienceFactor * 0.3; // 1.0-1.3x

      levelDelta = Math.round(amplified * (0.5 + escalationTendency * 0.5) * angerReactivity * impatienceBoost);
      levelDelta = Math.max(1, Math.min(levelDelta, 3)); // Cap single-turn jump at 3

      trustDelta = -Math.round(Math.abs(effectiveness) * 2);
      listeningDelta = -Math.round(Math.abs(effectiveness) * 1.5);
      triggerType = "escalation";
    } else if (effectiveness > deescalationDeadzone) {
      // --- De-escalation trigger ---
      let rawRecovery = effectiveness * 1.5;

      // Clinician bot is an expert — dampen its impact so recovery is gradual, not instant
      if (source === "clinician") {
        rawRecovery *= 0.5;
      }

      // Low trust slows recovery
      const trustPenalty = (10 - this.state.trust) / 20;
      // High anger resists de-escalation
      const angerResistance = this.state.anger >= 6 ? 0.6 : this.state.anger >= 4 ? 0.8 : 1.0;
      const recovery = rawRecovery * (1 - trustPenalty) * angerResistance;
      levelDelta = -Math.round(recovery);

      // Prevent perpetual round-to-zero: any meaningful recovery produces at least -1
      if (levelDelta === 0 && recovery >= 0.2) {
        levelDelta = -1;
      }

      levelDelta = Math.max(levelDelta, -2); // Cap single-turn drop at 2

      // Large drops are rare unless trust is already established
      if (levelDelta < -1 && this.state.trust < 4) {
        levelDelta = -1;
      }

      // Clinician trust gains are slower — real trust takes time
      const trustGainFactor = source === "clinician" ? 0.6 : 1.0;
      trustDelta = Math.round(effectiveness * trustGainFactor);
      // Prevent trust deadlock: any positive gain signal builds at least +1 trust
      if (trustDelta === 0 && effectiveness * trustGainFactor >= 0.2) {
        trustDelta = 1;
      }
      const listeningGainFactor = source === "clinician" ? 0.65 : 1.0;
      listeningDelta = Math.round(effectiveness * 1.5 * listeningGainFactor);
      if (listeningDelta === 0 && effectiveness * 1.5 * listeningGainFactor >= 0.2) {
        listeningDelta = 1;
      }
      triggerType = "de_escalation";
    } else {
      // Neutral — slight drift toward escalation tendency
      if (escalationTendency > 0.6) {
        levelDelta = Math.random() < 0.3 ? 1 : 0;
      }
    }

    // Track behaviour counts
    if (result.tags.includes("validation") || result.tags.includes("empathy")) {
      this.state.validations_count++;
    }

    // Apply deltas with clamping
    const ceiling = this.getEffectiveCeiling();
    const oldLevel = this.state.level;
    this.state.level = Math.max(1, Math.min(ceiling, this.state.level + levelDelta));
    this.state.trust = Math.max(0, Math.min(10, this.state.trust + trustDelta));
    this.state.willingness_to_listen = Math.max(0, Math.min(10, this.state.willingness_to_listen + listeningDelta));
    this.state.anger = Math.max(0, Math.min(10, this.state.anger + (levelDelta > 0 ? 1 : levelDelta < 0 ? -1 : 0)));
    this.state.frustration = Math.max(0, Math.min(10, this.state.frustration + (levelDelta > 0 ? 1 : 0)));
    this.syncDerivedFlags();

    return {
      level_delta: this.state.level - oldLevel,
      trust_delta: trustDelta,
      listening_delta: listeningDelta,
      reason,
      trigger_type: triggerType,
    };
  }
}
