"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { ScoringWeights } from "@/types/scenario";

interface ScoringConfigPanelProps {
  supportThreshold: number | null;
  criticalThreshold: number | null;
  scoringWeights: ScoringWeights | null;
  hasMilestones: boolean;
  onSupportThresholdChange: (value: number | null) => void;
  onCriticalThresholdChange: (value: number | null) => void;
  onWeightsChange: (weights: Partial<ScoringWeights>) => void;
}

const DEFAULT_WEIGHTS_4 = { composure: 25, de_escalation: 25, clinical_task: 25, support_seeking: 25 };
const DEFAULT_WEIGHTS_3 = { composure: 33, de_escalation: 34, clinical_task: 0, support_seeking: 33 };

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1 cursor-help text-muted-foreground" title={text}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-medium">i</span>
    </span>
  );
}

export function ScoringConfigPanel({
  supportThreshold,
  criticalThreshold,
  scoringWeights,
  hasMilestones,
  onSupportThresholdChange,
  onCriticalThresholdChange,
  onWeightsChange,
}: ScoringConfigPanelProps) {
  const defaults = hasMilestones ? DEFAULT_WEIGHTS_4 : DEFAULT_WEIGHTS_3;
  const w = {
    composure: Math.round((scoringWeights?.composure ?? defaults.composure / 100) * 100),
    de_escalation: Math.round((scoringWeights?.de_escalation ?? defaults.de_escalation / 100) * 100),
    clinical_task: hasMilestones
      ? Math.round((scoringWeights?.clinical_task ?? defaults.clinical_task / 100) * 100)
      : 0,
    support_seeking: Math.round((scoringWeights?.support_seeking ?? defaults.support_seeking / 100) * 100),
  };
  const total = w.composure + w.de_escalation + w.clinical_task + w.support_seeking;
  const validTotal = total === 100;

  const criticalValid =
    criticalThreshold == null ||
    supportThreshold == null ||
    criticalThreshold >= supportThreshold;

  return (
    <div className="space-y-5">
      {/* Support Threshold */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>
            Support Threshold
            <Tooltip text="The escalation level at which it becomes appropriate for the trainee to request the AI clinician's help. Below this level, requesting help is scored as premature. Once the trainee keeps talking at or above this level without asking for help, the support-seeking score drops." />
          </Label>
          <Input
            type="number"
            min={1}
            max={10}
            placeholder="e.g., 6"
            value={supportThreshold ?? ""}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : null;
              onSupportThresholdChange(v != null && v >= 1 && v <= 10 ? v : null);
            }}
          />
          <p className="text-[10px] text-muted-foreground">Recommended so support-seeking matches the scenario&apos;s intended intervention point</p>
        </div>

        {/* Critical Threshold */}
        <div className="space-y-1.5">
          <Label>
            Critical Threshold
            <Tooltip text="Optional. The escalation level at which missed support opportunities are judged even more harshly. Once the trainee keeps responding above the support threshold without asking for help, the score drops; if the unsupported situation worsens into this critical range or reaches level 10, it drops much more sharply." />
          </Label>
          <Input
            type="number"
            min={1}
            max={10}
            placeholder="e.g., 8"
            value={criticalThreshold ?? ""}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : null;
              onCriticalThresholdChange(v != null && v >= 1 && v <= 10 ? v : null);
            }}
          />
          {!criticalValid && (
            <p className="text-[10px] text-red-500">
              Critical threshold must be equal to or higher than the support threshold
            </p>
          )}
        </div>
      </div>

      {/* Scoring Weights */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>
            Scoring Weights
            <Tooltip text="How much each dimension contributes to the overall score. Adjust these to match what this scenario is designed to assess. The weights must add up to 100." />
          </Label>
          <span className={cn(
            "text-xs font-medium tabular-nums",
            validTotal ? "text-emerald-600" : "text-red-500"
          )}>
            {total}/100
          </span>
        </div>

        <WeightSlider
          label="Composure"
          tooltip="Did the trainee stay calm and professional? Scored from detection of defensive language, dismissiveness, sarcasm, and hostility mirroring."
          value={w.composure}
          onChange={(v) => onWeightsChange({ composure: v / 100 })}
        />
        <WeightSlider
          label="De-escalation"
          tooltip="How effectively did the trainee manage the subject's emotional state? Scored from de-escalation attempts and whether those attempts were effective."
          value={w.de_escalation}
          onChange={(v) => onWeightsChange({ de_escalation: v / 100 })}
        />
        <WeightSlider
          label="Clinical Task"
          tooltip="Did the trainee continue to address the clinical need? Only available when milestones are defined."
          value={w.clinical_task}
          onChange={(v) => onWeightsChange({ clinical_task: v / 100 })}
          disabled={!hasMilestones}
        />
        <WeightSlider
          label="Support Seeking"
          tooltip="Did the trainee request help at the right time? Scored from when the AI clinician was invoked relative to escalation thresholds."
          value={w.support_seeking}
          onChange={(v) => onWeightsChange({ support_seeking: v / 100 })}
        />

        {!validTotal && (
          <p className="text-[10px] text-red-500">Weights must add up to 100</p>
        )}
      </div>
    </div>
  );
}

function WeightSlider({
  label,
  tooltip,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  tooltip: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-1", disabled && "opacity-40 pointer-events-none")}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-700">
          {label}
          <Tooltip text={tooltip} />
        </span>
        <span className="text-[12px] font-bold tabular-nums text-slate-900">{value}</span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={5}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        disabled={disabled}
      />
    </div>
  );
}
