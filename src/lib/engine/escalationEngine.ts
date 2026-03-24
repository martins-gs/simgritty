import type { EscalationState, EscalationDelta } from "@/types/escalation";
import type { ClassifierResult } from "@/types/simulation";
import type { ScenarioTraits, EscalationRules } from "@/types/scenario";

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
      discrimination_active: traits.bias_intensity > 3 && traits.bias_category !== "none",
      interruptions_count: 0,
      validations_count: 0,
      unanswered_questions: 0,
    };
  }

  getState(): EscalationState {
    return { ...this.state };
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

  processClassification(result: ClassifierResult): EscalationDelta {
    const effectiveness = result.effectiveness; // -1 to +1
    const volatilityFactor = this.traits.volatility / 10;
    const escalationTendency = this.traits.escalation_tendency / 10;

    // Base delta from classifier effectiveness
    // Negative effectiveness = trainee did something escalating
    // Positive effectiveness = trainee did something de-escalating
    let levelDelta = 0;
    let trustDelta = 0;
    let listeningDelta = 0;
    let reason = result.reasoning;
    let triggerType: EscalationDelta["trigger_type"] = "neutral";

    if (effectiveness < -0.3) {
      // Escalation trigger
      const rawDelta = Math.abs(effectiveness) * 2; // 0-2 range
      const amplified = rawDelta * (1 + volatilityFactor * 0.5);
      levelDelta = Math.round(amplified * (0.5 + escalationTendency * 0.5));
      levelDelta = Math.max(1, Math.min(levelDelta, 3)); // Cap single-turn jump at 3

      trustDelta = -Math.round(Math.abs(effectiveness) * 2);
      listeningDelta = -Math.round(Math.abs(effectiveness) * 1.5);
      triggerType = "escalation";
    } else if (effectiveness > 0.3) {
      // De-escalation trigger
      const rawRecovery = effectiveness * 1.5;
      // Low trust slows recovery
      const trustPenalty = (10 - this.state.trust) / 20;
      const recovery = rawRecovery * (1 - trustPenalty);
      levelDelta = -Math.round(recovery);
      levelDelta = Math.max(levelDelta, -2); // Cap single-turn drop at 2

      // Large drops are rare unless trainee performs strongly and persona is recoverable
      if (levelDelta < -1 && this.state.trust < 3) {
        levelDelta = -1;
      }

      trustDelta = Math.round(effectiveness);
      listeningDelta = Math.round(effectiveness * 1.5);
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

    return {
      level_delta: this.state.level - oldLevel,
      trust_delta: trustDelta,
      listening_delta: listeningDelta,
      reason,
      trigger_type: triggerType,
    };
  }
}
