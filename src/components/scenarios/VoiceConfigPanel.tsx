"use client";

import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScenarioVoiceConfig } from "@/types/scenario";

const VOICES = [
  { id: "alloy", label: "Alloy" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "fable", label: "Fable" },
  { id: "nova", label: "Nova" },
  { id: "onyx", label: "Onyx" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "verse", label: "Verse" },
];

const PAUSE_STYLES = [
  { value: "natural", label: "Natural" },
  { value: "short_clipped", label: "Short & clipped" },
  { value: "long_dramatic", label: "Long & dramatic" },
  { value: "minimal", label: "Minimal" },
];

const INTERRUPTION_STYLES = [
  { value: "none", label: "None" },
  { value: "occasional", label: "Occasional" },
  { value: "frequent", label: "Frequent" },
  { value: "aggressive", label: "Aggressive" },
];

interface VoiceConfigPanelProps {
  config: ScenarioVoiceConfig;
  onChange: (partial: Partial<ScenarioVoiceConfig>) => void;
  disabled?: boolean;
}

export function VoiceConfigPanel({ config, onChange, disabled }: VoiceConfigPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-sm">Voice</Label>
        <Select
          value={config.voice_name}
          onValueChange={(v) => v && onChange({ voice_name: v })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICES.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Speaking Rate</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{config.speaking_rate.toFixed(2)}x</span>
        </div>
        <Slider
          value={[config.speaking_rate * 100]}
          min={50}
          max={200}
          step={5}
          disabled={disabled}
          onValueChange={(v) => onChange({ speaking_rate: (Array.isArray(v) ? v[0] : v) / 100 })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Expressiveness</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{config.expressiveness_level}/10</span>
        </div>
        <Slider
          value={[config.expressiveness_level]}
          min={0} max={10} step={1}
          disabled={disabled}
          onValueChange={(v) => onChange({ expressiveness_level: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Anger Expression</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{config.anger_expression}/10</span>
        </div>
        <Slider
          value={[config.anger_expression]}
          min={0} max={10} step={1}
          disabled={disabled}
          onValueChange={(v) => onChange({ anger_expression: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Sarcasm Expression</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{config.sarcasm_expression}/10</span>
        </div>
        <Slider
          value={[config.sarcasm_expression]}
          min={0} max={10} step={1}
          disabled={disabled}
          onValueChange={(v) => onChange({ sarcasm_expression: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Pause Style</Label>
        <Select
          value={config.pause_style}
          onValueChange={(v) => v && onChange({ pause_style: v as ScenarioVoiceConfig["pause_style"] })}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAUSE_STYLES.map((p) => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Interruption Style</Label>
        <Select
          value={config.interruption_style}
          onValueChange={(v) => v && onChange({ interruption_style: v as ScenarioVoiceConfig["interruption_style"] })}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {INTERRUPTION_STYLES.map((i) => (
              <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
