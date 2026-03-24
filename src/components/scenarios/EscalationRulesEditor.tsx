"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EscalationRules } from "@/types/scenario";
import { ESCALATION_LABELS } from "@/types/escalation";

interface EscalationRulesEditorProps {
  rules: EscalationRules;
  orgMaxCeiling: number;
  onChange: (partial: Partial<EscalationRules>) => void;
  disabled?: boolean;
}

export function EscalationRulesEditor({
  rules,
  orgMaxCeiling,
  onChange,
  disabled,
}: EscalationRulesEditorProps) {
  const effectiveCeiling = Math.min(rules.max_ceiling, orgMaxCeiling);

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Starting Escalation Level</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {rules.initial_level} — {ESCALATION_LABELS[rules.initial_level]}
          </span>
        </div>
        <Slider
          value={[rules.initial_level]}
          min={1}
          max={effectiveCeiling}
          step={1}
          disabled={disabled}
          onValueChange={(v) => onChange({ initial_level: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Maximum Escalation Ceiling</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {effectiveCeiling} — {ESCALATION_LABELS[effectiveCeiling]}
          </span>
        </div>
        <Slider
          value={[rules.max_ceiling]}
          min={1}
          max={orgMaxCeiling}
          step={1}
          disabled={disabled}
          onValueChange={(v) => onChange({ max_ceiling: Array.isArray(v) ? v[0] : v })}
        />
        {rules.max_ceiling > orgMaxCeiling && (
          <p className="text-xs text-destructive">
            Clamped to organization ceiling of {orgMaxCeiling}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          <Switch
            checked={rules.auto_end_threshold !== null}
            onCheckedChange={(checked) =>
              onChange({ auto_end_threshold: checked ? effectiveCeiling : null })
            }
            disabled={disabled}
          />
          <Label className="text-sm">Auto-end at ceiling</Label>
        </div>
        {rules.auto_end_threshold !== null && (
          <div className="ml-10 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Threshold</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {rules.auto_end_threshold}
              </span>
            </div>
            <Slider
              value={[rules.auto_end_threshold]}
              min={rules.initial_level}
              max={effectiveCeiling}
              step={1}
              disabled={disabled}
              onValueChange={(v) => onChange({ auto_end_threshold: Array.isArray(v) ? v[0] : v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
