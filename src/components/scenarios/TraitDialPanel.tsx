"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { TRAIT_DIALS, TRAIT_CATEGORIES, BIAS_CATEGORIES } from "@/lib/engine/traitDials";
import { cn } from "@/lib/utils";
import type { ScenarioTraits, BiasCategory } from "@/types/scenario";

interface TraitDialPanelProps {
  traits: ScenarioTraits;
  onTraitChange: (key: keyof ScenarioTraits, value: number | BiasCategory) => void;
  disabled?: boolean;
}

// Convert stored bias_category string to active set
// Supports: "none", single value like "gender", or comma-separated like "gender,racial,age"
function parseBiasCategories(value: string): Set<string> {
  if (!value || value === "none") return new Set();
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
}

// Convert active set back to stored string
function serializeBiasCategories(active: Set<string>): string {
  if (active.size === 0) return "none";
  return [...active].join(",");
}

export function TraitDialPanel({ traits, onTraitChange, disabled }: TraitDialPanelProps) {
  const activeBias = parseBiasCategories(traits.bias_category);

  function toggleBias(cat: string) {
    const next = new Set(activeBias);
    if (next.has(cat)) {
      next.delete(cat);
    } else {
      next.add(cat);
    }
    onTraitChange("bias_category", serializeBiasCategories(next));

    // Auto-set bias_intensity to at least 3 if any category is active
    if (next.size > 0 && (traits.bias_intensity as number) < 3) {
      onTraitChange("bias_intensity", 3);
    }
    if (next.size === 0) {
      onTraitChange("bias_intensity", 0);
    }
  }

  return (
    <div className="space-y-6">
      {TRAIT_CATEGORIES.map((category) => {
        const dials = TRAIT_DIALS.filter((d) => d.category === category.key);
        return (
          <div key={category.key}>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {category.label}
            </h4>
            <div className="space-y-4">
              {dials.map((dial) => {
                const value = traits[dial.key] as number;
                return (
                  <div key={dial.key} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[13px]">{dial.label}</Label>
                      <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                        {value}/10
                      </span>
                    </div>
                    <Slider
                      value={[value]}
                      min={dial.min}
                      max={dial.max}
                      step={1}
                      disabled={disabled}
                      onValueChange={(v) => onTraitChange(dial.key, Array.isArray(v) ? v[0] : v)}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{dial.lowLabel}</span>
                      <span>{dial.highLabel}</span>
                    </div>
                  </div>
                );
              })}
              {category.key === "cognitive" && (
                <div className="space-y-2">
                  <Label className="text-[13px]">Bias categories</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {BIAS_CATEGORIES.filter((bc) => bc.value !== "none" && bc.value !== "mixed").map((bc) => {
                      const isActive = activeBias.has(bc.value);
                      return (
                        <button
                          key={bc.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleBias(bc.value)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-[12px] font-medium transition-all",
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          )}
                        >
                          {bc.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {activeBias.size === 0
                      ? "No bias active. Select categories to enable discriminatory behaviour in the scenario."
                      : `${activeBias.size} active. Bias intensity slider above controls the strength.`}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
