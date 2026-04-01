"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, MoreHorizontal, Play, Copy, Archive, Pencil } from "lucide-react";

interface ScenarioListItem {
  id: string;
  title: string;
  setting: string;
  difficulty: string;
  status: string;
  archetype_tag: string | null;
  ai_role: string;
  trainee_role: string;
  created_at: string;
}

const difficultyDot: Record<string, string> = {
  low: "bg-emerald-500",
  moderate: "bg-amber-500",
  high: "bg-orange-500",
  extreme: "bg-red-500",
};

export default function ScenariosPage() {
  const router = useRouter();
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "published" | "draft">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/scenarios");
        if (res.ok) setScenarios(await res.json());
        else toast.error("Failed to load scenarios");
      } catch {
        toast.error("Failed to load scenarios");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = scenarios.filter((s) => {
    if (tab !== "all" && s.status !== tab) return false;
    if (search && !s.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  async function handleDuplicate(id: string) {
    const res = await fetch(`/api/scenarios/${id}`);
    if (!res.ok) {
      toast.error("Failed to load scenario for duplication");
      return;
    }
    const data = await res.json();
    const traits = Array.isArray(data.scenario_traits) ? data.scenario_traits[0] : data.scenario_traits;
    const voice = Array.isArray(data.scenario_voice_config) ? data.scenario_voice_config[0] : data.scenario_voice_config;
    const rules = Array.isArray(data.escalation_rules) ? data.escalation_rules[0] : data.escalation_rules;

    const createRes = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${data.title} (copy)`,
        setting: data.setting, trainee_role: data.trainee_role, ai_role: data.ai_role,
        backstory: data.backstory, emotional_driver: data.emotional_driver,
        difficulty: data.difficulty, archetype_tag: data.archetype_tag,
        learning_objectives: data.learning_objectives || "",
        pre_simulation_briefing_text: data.pre_simulation_briefing_text || "",
        content_warning_text: data.content_warning_text || "",
        educator_facilitation_recommended: data.educator_facilitation_recommended || false,
        traits: traits || {}, publish: false,
        voice_config: voice ? {
          voice_name: voice.voice_name, speaking_rate: Number(voice.speaking_rate),
          expressiveness_level: voice.expressiveness_level, anger_expression: voice.anger_expression,
          sarcasm_expression: voice.sarcasm_expression, pause_style: voice.pause_style,
          interruption_style: voice.interruption_style,
        } : {},
        escalation_rules: rules || {},
      }),
    });
    if (createRes.ok) {
      const { id: newId } = await createRes.json();
      toast.success("Duplicated");
      router.push(`/scenarios/${newId}`);
    } else {
      toast.error("Failed to duplicate scenario");
    }
  }

  async function handleArchive(id: string) {
    const res = await fetch(`/api/scenarios/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (res.ok) {
      setScenarios((prev) => prev.filter((s) => s.id !== id));
      toast.success("Archived");
    } else {
      toast.error("Failed to archive scenario");
    }
  }

  const tabs = [
    { key: "all" as const, label: "All" },
    { key: "published" as const, label: "Published" },
    { key: "draft" as const, label: "Drafts" },
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Scenarios</h1>
          <Link
            href="/scenarios/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New scenario
          </Link>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-border/60 bg-card p-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
                  tab === t.key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <p className="py-12 text-center text-[13px] text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/80 py-12 text-center">
            <p className="text-[13px] text-muted-foreground">
              {scenarios.length === 0 ? "No scenarios yet" : "No matches"}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 bg-card">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_120px_100px_80px_36px] items-center gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Scenario</span>
              <span>Setting</span>
              <span>Difficulty</span>
              <span>Status</span>
              <span />
            </div>
            {/* Rows */}
            <div className="divide-y divide-border/40">
              {filtered.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1fr_120px_100px_80px_36px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/30"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/scenarios/${s.id}`}
                      className="text-[13px] font-medium hover:underline truncate block"
                    >
                      {s.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {s.trainee_role}{s.ai_role ? ` / ${s.ai_role}` : ""}
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground truncate">
                    {s.setting || "—"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${difficultyDot[s.difficulty] || "bg-gray-400"}`} />
                    <span className="text-[12px] capitalize">{s.difficulty}</span>
                  </div>
                  <Badge
                    variant={s.status === "published" ? "default" : "secondary"}
                    className="text-[10px] w-fit"
                  >
                    {s.status}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem render={<Link href={`/scenarios/${s.id}`} />}>
                        <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                      </DropdownMenuItem>
                      {s.status === "published" && (
                        <DropdownMenuItem render={<Link href={`/scenarios/${s.id}/briefing`} />}>
                          <Play className="mr-2 h-3.5 w-3.5" /> Run
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleDuplicate(s.id)}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleArchive(s.id)}>
                        <Archive className="mr-2 h-3.5 w-3.5" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
