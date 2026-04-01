"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import type { OrgSettings } from "@/types/governance";

interface OrgSettingsFormProps {
  settings: OrgSettings;
  isAdmin: boolean;
}

export function OrgSettingsForm({ settings: initial, isAdmin }: OrgSettingsFormProps) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/org-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (res.ok) {
      toast.success("Settings saved");
    } else {
      const err = await res.json().catch(() => null);
      toast.error(err?.error || "Failed to save settings");
    }
    setSaving(false);
  }

  if (!isAdmin) {
    return (
      <p className="text-[13px] text-muted-foreground py-8">
        You need admin access to change organization settings.
      </p>
    );
  }

  return (
    <div className="space-y-8 max-w-xl">
      {/* Content governance */}
      <section>
        <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground mb-4">
          Content governance
        </h3>
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-[13px] font-medium">Allow discriminatory content</Label>
              <p className="text-[12px] text-muted-foreground mt-0.5 max-w-sm">
                Enables scenarios with simulated discriminatory language for training purposes
              </p>
            </div>
            <Switch
              checked={settings.allow_discriminatory_content}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, allow_discriminatory_content: v }))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[13px]">Maximum escalation ceiling</Label>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {settings.max_escalation_ceiling}/10
              </span>
            </div>
            <Slider
              value={[settings.max_escalation_ceiling]}
              min={1}
              max={10}
              step={1}
              onValueChange={(v) => setSettings((s) => ({ ...s, max_escalation_ceiling: Array.isArray(v) ? v[0] : v }))}
            />
            <p className="text-[12px] text-muted-foreground">
              No scenario can exceed this level
            </p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-[13px] font-medium">Require consent gate</Label>
              <p className="text-[12px] text-muted-foreground mt-0.5 max-w-sm">
                Trainees must acknowledge content warnings before starting any simulation
              </p>
            </div>
            <Switch
              checked={settings.require_consent_gate}
              onCheckedChange={(v) => setSettings((s) => ({ ...s, require_consent_gate: v }))}
            />
          </div>
        </div>
      </section>

      {/* Session limits */}
      <section>
        <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground mb-4">
          Session limits
        </h3>
        <div className="space-y-1.5">
          <Label className="text-[13px]">Maximum session duration (minutes)</Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={settings.max_session_duration_minutes}
            onChange={(e) => setSettings((s) => ({ ...s, max_session_duration_minutes: parseInt(e.target.value) || 30 }))}
            className="w-28 h-9"
          />
          <p className="text-[12px] text-muted-foreground">Sessions will auto-end after this duration</p>
        </div>
      </section>

      {/* Save */}
      <div className="border-t border-border/60 pt-5">
        <Button onClick={handleSave} disabled={saving} className="text-[13px]">
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
