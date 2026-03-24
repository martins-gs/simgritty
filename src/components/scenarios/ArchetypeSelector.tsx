"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ARCHETYPE_PRESETS } from "@/lib/engine/archetypePresets";

interface ArchetypeSelectorProps {
  value: string | null;
  onSelect: (tag: string | null) => void;
}

export function ArchetypeSelector({ value, onSelect }: ArchetypeSelectorProps) {
  return (
    <div className="space-y-2">
      <Select
        value={value ?? "custom"}
        onValueChange={(v) => v !== null && onSelect(v === "custom" ? null : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose an archetype or start from scratch" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="custom">Start from scratch</SelectItem>
          {ARCHETYPE_PRESETS.map((a) => (
            <SelectItem key={a.tag} value={a.tag}>
              <span className="flex items-center gap-2">
                {a.label}
                <Badge variant="secondary" className="text-[10px]">
                  {a.difficulty}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <p className="text-xs text-muted-foreground">
          {ARCHETYPE_PRESETS.find((a) => a.tag === value)?.description}
        </p>
      )}
    </div>
  );
}
