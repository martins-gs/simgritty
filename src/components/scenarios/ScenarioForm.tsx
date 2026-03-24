"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TraitDialPanel } from "./TraitDialPanel";
import { VoiceConfigPanel } from "./VoiceConfigPanel";
import { EscalationRulesEditor } from "./EscalationRulesEditor";
import { ArchetypeSelector } from "./ArchetypeSelector";
import { useScenarioStore } from "@/store/scenarioStore";
import { getArchetypeByTag } from "@/lib/engine/archetypePresets";
import type { Difficulty, BiasCategory } from "@/types/scenario";

interface ScenarioFormProps {
  scenarioId?: string;
  orgMaxCeiling?: number;
}

export function ScenarioForm({ scenarioId, orgMaxCeiling = 8 }: ScenarioFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const store = useScenarioStore();

  function handleArchetypeChange(tag: string | null) {
    if (!tag) {
      store.setField("archetype_tag", null);
      return;
    }
    const archetype = getArchetypeByTag(tag);
    if (!archetype) return;

    store.applyArchetype({
      traits: archetype.traits,
      voice_config: archetype.voice_config,
      escalation_rules: archetype.escalation_rules,
      defaults: {
        archetype_tag: tag,
        difficulty: archetype.difficulty,
        setting: archetype.defaults.setting,
        ai_role: archetype.defaults.ai_role,
        trainee_role: archetype.defaults.trainee_role,
        emotional_driver: archetype.defaults.emotional_driver,
        backstory: archetype.defaults.backstory,
        content_warning_text: archetype.defaults.content_warning_text,
        pre_simulation_briefing_text: archetype.defaults.pre_simulation_briefing_text,
      } as Partial<typeof store>,
    });
  }

  async function handleSave(publish: boolean) {
    if (!store.title.trim()) {
      toast.error("Title is required");
      return;
    }

    setSaving(true);
    try {
      const body = {
        title: store.title,
        setting: store.setting,
        trainee_role: store.trainee_role,
        ai_role: store.ai_role,
        backstory: store.backstory,
        emotional_driver: store.emotional_driver,
        difficulty: store.difficulty,
        archetype_tag: store.archetype_tag,
        learning_objectives: store.learning_objectives,
        pre_simulation_briefing_text: store.pre_simulation_briefing_text,
        content_warning_text: store.content_warning_text,
        educator_facilitation_recommended: store.educator_facilitation_recommended,
        traits: store.traits,
        voice_config: store.voice_config,
        escalation_rules: store.escalation_rules,
        publish,
      };

      const url = scenarioId ? `/api/scenarios/${scenarioId}` : "/api/scenarios";
      const method = scenarioId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save scenario");
      }

      const data = await res.json();
      toast.success(publish ? "Scenario published" : "Scenario saved");
      router.push(`/scenarios/${data.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Archetype Selector */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Starting point</h3>
        <ArchetypeSelector
          value={store.archetype_tag}
          onSelect={handleArchetypeChange}
        />
      </section>

      {/* Scenario Basics */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Scenario basics</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={store.title}
              onChange={(e) => store.setField("title", e.target.value)}
              placeholder="e.g., Registrar dealing with angry relative"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Clinical Setting</Label>
              <Input
                value={store.setting}
                onChange={(e) => store.setField("setting", e.target.value)}
                placeholder="e.g., Hospital ward"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <Select
                value={store.difficulty}
                onValueChange={(v) => v && store.setField("difficulty", v as Difficulty)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="extreme">Extreme</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Trainee Role</Label>
              <Input
                value={store.trainee_role}
                onChange={(e) => store.setField("trainee_role", e.target.value)}
                placeholder="e.g., Registrar"
              />
            </div>
            <div className="space-y-1.5">
              <Label>AI Character Role</Label>
              <Input
                value={store.ai_role}
                onChange={(e) => store.setField("ai_role", e.target.value)}
                placeholder="e.g., Relative of patient"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Backstory</Label>
            <Textarea
              value={store.backstory}
              onChange={(e) => store.setField("backstory", e.target.value)}
              placeholder="Background context for the AI character..."
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Emotional Driver</Label>
            <Textarea
              value={store.emotional_driver}
              onChange={(e) => store.setField("emotional_driver", e.target.value)}
              placeholder="What is driving this person's emotional state?"
              rows={2}
            />
          </div>
        </div>
      </section>

      {/* Trait Dials */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Character traits</h3>
          <TraitDialPanel
            traits={store.traits}
            onTraitChange={(key, value) => {
              if (key === "bias_category") {
                store.setTraits({ bias_category: value as BiasCategory });
              } else {
                store.setTraits({ [key]: value as number });
              }
            }}
          />
      </section>

      {/* Voice Config */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Voice settings</h3>
          <VoiceConfigPanel
            config={store.voice_config}
            onChange={store.setVoiceConfig}
          />
      </section>

      {/* Escalation Rules */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Escalation rules</h3>
          <EscalationRulesEditor
            rules={store.escalation_rules}
            orgMaxCeiling={orgMaxCeiling}
            onChange={store.setEscalationRules}
          />
      </section>

      {/* Safety & Briefing */}
      <section>
        <h3 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Safety & briefing</h3>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Content Warning</Label>
            <Textarea
              value={store.content_warning_text}
              onChange={(e) => store.setField("content_warning_text", e.target.value)}
              placeholder="Describe what the trainee should expect..."
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Pre-Simulation Briefing</Label>
            <Textarea
              value={store.pre_simulation_briefing_text}
              onChange={(e) => store.setField("pre_simulation_briefing_text", e.target.value)}
              placeholder="Context shown to the trainee before starting..."
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Learning Objectives</Label>
            <Textarea
              value={store.learning_objectives}
              onChange={(e) => store.setField("learning_objectives", e.target.value)}
              placeholder="What should the trainee demonstrate? (one per line)"
              rows={3}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={store.educator_facilitation_recommended}
              onCheckedChange={(v) => store.setField("educator_facilitation_recommended", v)}
            />
            <Label className="text-sm">Recommend educator facilitation for this scenario</Label>
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex justify-end gap-3 border-t border-border/60 pt-5 pb-8">
        <Button
          variant="outline"
          onClick={() => handleSave(false)}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Draft"}
        </Button>
        <Button
          onClick={() => handleSave(true)}
          disabled={saving}
        >
          {saving ? "Publishing..." : "Publish"}
        </Button>
      </div>
    </div>
  );
}
