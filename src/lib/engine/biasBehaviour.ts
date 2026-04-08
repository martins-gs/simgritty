import type { EscalationState } from "@/types/escalation";
import type { ScenarioTraits } from "@/types/scenario";

type BiasTraitConfig = Pick<ScenarioTraits, "bias_intensity" | "bias_category">;
type BiasActivationState = Pick<EscalationState, "level" | "anger">;

export const BIAS_LABELS: Record<string, string> = {
  gender: "gender-based prejudice (sexist remarks, assumptions about capability based on gender)",
  racial: "racial prejudice (racist remarks, assumptions based on ethnicity or skin colour)",
  age: "age-based prejudice (dismissing someone as too young or too old)",
  accent: "accent-based prejudice (mocking or refusing to engage based on how someone speaks)",
  class_status: "class/social status prejudice (looking down on or up to someone based on perceived social standing)",
  role_status: "role-based prejudice (dismissing someone based on their professional role, e.g. 'you're just a nurse')",
};

export function hasConfiguredBias(traits: BiasTraitConfig): boolean {
  return traits.bias_intensity > 0 && traits.bias_category !== "none";
}

export function formatBiasCategories(biasCategory: string): string {
  if (biasCategory === "none" || !biasCategory) return "none";
  const categories = biasCategory.split(",").map((value) => value.trim());
  return categories.map((category) => BIAS_LABELS[category] || category).join("; ");
}

export function isDiscriminationActive(
  traits: BiasTraitConfig,
  state: BiasActivationState
): boolean {
  if (!hasConfiguredBias(traits)) {
    return false;
  }

  const intensity = traits.bias_intensity;
  const { level, anger } = state;

  if (intensity >= 8) {
    return true;
  }
  if (intensity >= 6) {
    return level >= 4 || anger >= 5;
  }
  if (intensity >= 4) {
    return level >= 6 || anger >= 7;
  }
  return level >= 8;
}
