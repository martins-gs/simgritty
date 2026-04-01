"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { MilestoneFormItem } from "@/store/scenarioStore";

interface MilestonesEditorProps {
  milestones: MilestoneFormItem[];
  onAdd: () => void;
  onUpdate: (index: number, data: Partial<MilestoneFormItem>) => void;
  onRemove: (index: number) => void;
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1 cursor-help text-muted-foreground" title={text}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-medium">i</span>
    </span>
  );
}

export function MilestonesEditor({
  milestones,
  onAdd,
  onUpdate,
  onRemove,
}: MilestonesEditorProps) {
  const canAdd = milestones.length < 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {milestones.length === 0
            ? "No milestones defined \u2014 clinical task will not be scored"
            : `${milestones.length} milestone${milestones.length === 1 ? "" : "s"} defined`}
        </p>
      </div>

      {milestones.map((milestone, index) => (
        <div key={index} className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <span className="shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
              {index + 1}
            </span>
            <div className="flex-1 space-y-3">
              <div className="space-y-1.5">
                <Label>
                  Description
                  <Tooltip text="A short, human-readable description of what the trainee needs to do. This is shown to the trainee on the review page after the session. Keep it under 10 words." />
                </Label>
                <Input
                  value={milestone.description}
                  onChange={(e) => onUpdate(index, { description: e.target.value })}
                  placeholder="e.g., Establish what is happening with the discharge"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Classifier Hint
                  <Tooltip text="A plain-language description of what the trainee might say to complete this milestone. Be specific \u2014 include example phrases. The AI classifier uses this to detect completion." />
                </Label>
                <Textarea
                  value={milestone.classifier_hint}
                  onChange={(e) => onUpdate(index, { classifier_hint: e.target.value })}
                  placeholder="e.g., The trainee asks about the patient's situation, how long they've been waiting, or what they are waiting for"
                  rows={2}
                  maxLength={300}
                />
                {milestone.classifier_hint.length < 20 && (
                  <p className="text-[10px] text-amber-600">
                    {milestone.classifier_hint.length === 0
                      ? "Add a classifier hint \u2014 without one the AI cannot detect when this milestone is completed"
                      : "Hint is short \u2014 add more detail for reliable detection"}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-red-500"
              onClick={() => onRemove(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        onClick={onAdd}
        disabled={!canAdd}
        title={!canAdd ? "Maximum 10 milestones per scenario. Fewer milestones with strong classifier hints produce more reliable scores than many milestones with weak hints." : undefined}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add milestone
      </Button>
    </div>
  );
}
