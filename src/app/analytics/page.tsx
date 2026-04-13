"use client";

import { startTransition, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChartScatter,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  EducatorAnalyticsResponse,
  EducatorAttemptView,
  EducatorConversationStage,
} from "@/lib/analytics/types";

const ALL_VALUE = "__all";

interface FilterState {
  scenario: string | null;
  scenarioType: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  attemptView: EducatorAttemptView;
  promptVersion: string | null;
}

const INITIAL_FILTERS: FilterState = {
  scenario: null,
  scenarioType: null,
  dateFrom: null,
  dateTo: null,
  attemptView: "all",
  promptVersion: null,
};

function buildQueryString(filters: FilterState) {
  const params = new URLSearchParams();
  if (filters.scenario) params.set("scenario", filters.scenario);
  if (filters.scenarioType) params.set("scenarioType", filters.scenarioType);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.attemptView !== "all") params.set("attemptView", filters.attemptView);
  if (filters.promptVersion) params.set("promptVersion", filters.promptVersion);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function getTrendColor(trend: string) {
  if (trend === "improving") return "#15803d";
  if (trend === "worsening") return "#b91c1c";
  return "#475569";
}

function getHeatmapBackground(intensity: number) {
  if (intensity >= 75) return "bg-red-500/85 text-white";
  if (intensity >= 55) return "bg-orange-400/80 text-slate-950";
  if (intensity >= 35) return "bg-amber-300/80 text-slate-950";
  if (intensity >= 15) return "bg-sky-100 text-slate-700";
  return "bg-muted/60 text-muted-foreground";
}

function getPriorityBadgeVariant(level: string) {
  if (level === "high") return "default";
  if (level === "medium") return "secondary";
  return "outline";
}

function FilterField({
  label,
  children,
  helper,
}: {
  label: string;
  children: React.ReactNode;
  helper?: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/80 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2">{children}</div>
      {helper ? <p className="mt-1.5 text-[11px] text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

function AnalyticsHeadlineCard({
  title,
  label,
  summary,
  icon: Icon,
}: {
  title: string;
  label: string | null;
  summary: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="border border-border/60 bg-gradient-to-br from-card via-card to-muted/30">
      <CardHeader className="border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-1 text-lg">{label ?? "No clear signal yet"}</CardTitle>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">{summary}</p>
      </CardContent>
    </Card>
  );
}

function MatrixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; learner_prevalence_pct: number; avg_impact_score: number; persistence_pct: number; trend: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-xl border border-border/70 bg-popover px-3 py-2 shadow-lg">
      <p className="text-[12px] font-semibold text-popover-foreground">{point.label}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Prevalence {Math.round(point.learner_prevalence_pct)}% · Avg impact {point.avg_impact_score.toFixed(1)} · Persistence {Math.round(point.persistence_pct)}%
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">Trend: {point.trend}</p>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border border-dashed border-border/80 bg-card/60">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ChartScatter className="h-5 w-5" />
        </div>
        <p className="mt-4 text-base font-semibold">{title}</p>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function PriorityTable({ data }: { data: EducatorAnalyticsResponse["report"]["top_struggle_areas"] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
      <table className="min-w-full divide-y divide-border/60 text-left text-[13px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3">Priority</th>
            <th className="px-4 py-3">Skill Theme</th>
            <th className="px-4 py-3">% Learners</th>
            <th className="px-4 py-3">Avg Impact</th>
            <th className="px-4 py-3">Most Affected Scenarios</th>
            <th className="px-4 py-3">Typical Learner Pattern</th>
            <th className="px-4 py-3">What to Emphasise in Class</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {data.map((item) => (
            <tr key={item.theme} className="align-top">
              <td className="px-4 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-foreground">{item.priority_rank}</span>
                  <Badge variant={getPriorityBadgeVariant(item.priority_level)}>{item.priority_level}</Badge>
                </div>
              </td>
              <td className="px-4 py-4 font-medium">{item.theme.replace(/_/g, " ")}</td>
              <td className="px-4 py-4">{item.learner_prevalence_pct}%</td>
              <td className="px-4 py-4 text-muted-foreground">{item.avg_impact_summary}</td>
              <td className="px-4 py-4">
                <div className="space-y-1">
                  {item.most_affected_scenarios.map((scenario) => (
                    <p key={scenario}>{scenario}</p>
                  ))}
                </div>
              </td>
              <td className="px-4 py-4">
                <div className="space-y-1">
                  {item.typical_behaviours_seen.map((behaviour) => (
                    <p key={behaviour} className="text-muted-foreground">
                      {behaviour}
                    </p>
                  ))}
                </div>
              </td>
              <td className="px-4 py-4 text-muted-foreground">{item.what_to_emphasise_in_class}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageLabel({ stage }: { stage: EducatorConversationStage }) {
  return stage.replace(/_/g, " ");
}

export default function AnalyticsPage() {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [data, setData] = useState<EducatorAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);

      try {
        const response = await fetch(`/api/analytics/educator${buildQueryString(filters)}`, {
          cache: "no-store",
        });

        if (response.status === 403) {
          if (!cancelled) {
            setForbidden(true);
            setData(null);
          }
          return;
        }

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Failed to load analytics");
        }

        const payload = (await response.json()) as EducatorAnalyticsResponse;
        if (!cancelled) {
          setData(payload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load analytics");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-5 py-6 text-white shadow-xl sm:px-7 sm:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge className="bg-white/10 text-white hover:bg-white/10">Educator analytics</Badge>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
                Make the teaching priorities obvious.
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-white/75">
                This view summarises recurring learner communication problems across recorded simulations, highlights where they do the most damage, and turns them into concrete tutorial and debrief actions.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Learners</p>
                <p className="mt-1 text-2xl font-semibold">{data?.report.population_summary.learners ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Sessions</p>
                <p className="mt-1 text-2xl font-semibold">{data?.report.population_summary.sessions ?? "—"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">Scenarios</p>
                <p className="mt-1 text-2xl font-semibold">{data?.report.population_summary.scenarios ?? "—"}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Filters</h2>
              <p className="text-[13px] text-muted-foreground">
                Compare cohorts, scenarios, attempt stages, and prompt versions without losing sight of the teaching question.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => startTransition(() => setFilters(INITIAL_FILTERS))}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Reset filters
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <FilterField label="Cohort" helper="Organisation-wide cohort">
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[13px] text-foreground">
                {data?.available_filters.cohort_label ?? "Current organisation"}
              </div>
            </FilterField>

            <FilterField label="Profession / Grade" helper="Not captured in the current dataset">
              <Input value="Not captured" disabled />
            </FilterField>

            <FilterField label="Scenario">
              <Select
                value={filters.scenario ?? ALL_VALUE}
                onValueChange={(value) => startTransition(() => setFilters((current) => ({
                  ...current,
                  scenario: value === ALL_VALUE ? null : value,
                })))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All scenarios" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All scenarios</SelectItem>
                  {data?.available_filters.scenarios.map((scenario) => (
                    <SelectItem key={scenario.value} value={scenario.value}>
                      {scenario.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Scenario Type">
              <Select
                value={filters.scenarioType ?? ALL_VALUE}
                onValueChange={(value) => startTransition(() => setFilters((current) => ({
                  ...current,
                  scenarioType: value === ALL_VALUE ? null : value,
                })))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All scenario types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All scenario types</SelectItem>
                  {data?.available_filters.scenario_types.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Date Range">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  min={data?.available_filters.min_date ?? undefined}
                  max={data?.available_filters.max_date ?? undefined}
                  value={filters.dateFrom ?? ""}
                  onChange={(event) => startTransition(() => setFilters((current) => ({
                    ...current,
                    dateFrom: event.target.value || null,
                  })))}
                />
                <Input
                  type="date"
                  min={data?.available_filters.min_date ?? undefined}
                  max={data?.available_filters.max_date ?? undefined}
                  value={filters.dateTo ?? ""}
                  onChange={(event) => startTransition(() => setFilters((current) => ({
                    ...current,
                    dateTo: event.target.value || null,
                  })))}
                />
              </div>
            </FilterField>

            <FilterField label="First Attempt vs Repeat Attempts">
              <Select
                value={filters.attemptView}
                onValueChange={(value) => startTransition(() => setFilters((current) => ({
                  ...current,
                  attemptView: value as EducatorAttemptView,
                })))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All attempts</SelectItem>
                  <SelectItem value="first">First attempts</SelectItem>
                  <SelectItem value="repeat">Repeat attempts</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Site / Programme" helper="Mapped from organisation">
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[13px] text-foreground">
                {data?.available_filters.site_programme_label ?? "Current organisation"}
              </div>
            </FilterField>

            <FilterField label="Educator / Facilitator" helper="Not captured in the current dataset">
              <Input value="Not captured" disabled />
            </FilterField>

            <FilterField label="Prompt Version">
              <Select
                value={filters.promptVersion ?? ALL_VALUE}
                onValueChange={(value) => startTransition(() => setFilters((current) => ({
                  ...current,
                  promptVersion: value === ALL_VALUE ? null : value,
                })))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All prompt versions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All prompt versions</SelectItem>
                  {data?.available_filters.prompt_versions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </section>

        {forbidden ? (
          <EmptyState
            title="Educator access required"
            description="This analytics view is restricted to educator and admin accounts because it aggregates cohort-level learner evidence."
          />
        ) : null}

        {!forbidden && error ? (
          <EmptyState
            title="Analytics unavailable"
            description={error}
          />
        ) : null}

        {!forbidden && !error && loading ? (
          <EmptyState
            title="Preparing educator analytics"
            description="Loading stored review evidence, session attempts, and scenario hotspots."
          />
        ) : null}

        {!forbidden && !error && !loading && data && data.report.population_summary.sessions === 0 ? (
          <EmptyState
            title="No analysable sessions for this filter set"
            description="Try widening the date range or clearing the scenario and prompt filters. This dashboard only uses sessions with stored review artefacts."
          />
        ) : null}

        {!forbidden && !error && !loading && data && data.report.population_summary.sessions > 0 ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <AnalyticsHeadlineCard
                title={data.dashboard.headline_cards.most_widespread.title}
                label={data.dashboard.headline_cards.most_widespread.label}
                summary={data.dashboard.headline_cards.most_widespread.summary}
                icon={Users}
              />
              <AnalyticsHeadlineCard
                title={data.dashboard.headline_cards.most_harmful.title}
                label={data.dashboard.headline_cards.most_harmful.label}
                summary={data.dashboard.headline_cards.most_harmful.summary}
                icon={AlertTriangle}
              />
              <AnalyticsHeadlineCard
                title={data.dashboard.headline_cards.most_improved_on_repeat_attempts.title}
                label={data.dashboard.headline_cards.most_improved_on_repeat_attempts.label}
                summary={data.dashboard.headline_cards.most_improved_on_repeat_attempts.summary}
                icon={Sparkles}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <Card className="border border-border/60">
                <CardHeader className="border-b border-border/50">
                  <CardTitle>Priority Matrix</CardTitle>
                  <CardDescription>
                    Top-right is what to teach next: common problems that do clear conversational damage and keep recurring.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-5">
                  <div className="h-[360px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                        <XAxis
                          type="number"
                          dataKey="learner_prevalence_pct"
                          name="Learner prevalence"
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <YAxis
                          type="number"
                          dataKey="avg_impact_score"
                          name="Average impact"
                          domain={[0, "dataMax + 4"]}
                        />
                        <ZAxis
                          type="number"
                          dataKey="persistence_pct"
                          range={[120, 1000]}
                          name="Persistence"
                        />
                        <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: "4 4" }} />
                        {(["improving", "static", "worsening"] as const).map((trend) => (
                          <Scatter
                            key={trend}
                            data={data.dashboard.priority_matrix.filter((point) => point.trend === trend)}
                            fill={getTrendColor(trend)}
                          />
                        ))}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline">X: learner prevalence</Badge>
                    <Badge variant="outline">Y: average impact</Badge>
                    <Badge variant="outline">Bubble size: persistence across attempts</Badge>
                    <Badge variant="outline">Colour: improving, static, worsening</Badge>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border/60">
                <CardHeader className="border-b border-border/50">
                  <CardTitle>Conversation-Stage Breakdown</CardTitle>
                  <CardDescription>
                    Where the breakdown is happening most often in the analysed sessions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {data.dashboard.conversation_stage_breakdown.map((item) => (
                    <div key={item.stage} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[13px] font-medium capitalize">
                          <StageLabel stage={item.stage} />
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {item.count} moments · {item.pct}%
                        </p>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${item.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Ranked Struggle Table</h2>
                <p className="text-[13px] text-muted-foreground">
                  Use this to decide what to emphasise in the next tutorial, debrief, or repeat practice block.
                </p>
              </div>
              <PriorityTable data={data.report.top_struggle_areas} />
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Scenario × Struggle Heatmap</h2>
                <p className="text-[13px] text-muted-foreground">
                  This shows whether a skill problem is general across the course or largely being exposed by one scenario.
                </p>
              </div>
              <div className="overflow-x-auto rounded-xl border border-border/60 bg-card p-4">
                <div
                  className="grid min-w-[760px] gap-2"
                  style={{
                    gridTemplateColumns: `minmax(220px, 1.4fr) repeat(${data.dashboard.heatmap.themes.length}, minmax(120px, 1fr))`,
                  }}
                >
                  <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Scenario
                  </div>
                  {data.dashboard.heatmap.themes.map((theme) => (
                    <div
                      key={theme.theme}
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                    >
                      {theme.label}
                    </div>
                  ))}
                  {data.dashboard.heatmap.scenarios.map((scenario) => (
                    <div key={scenario} className="contents">
                      <div className="flex items-center px-3 py-3 text-[13px] font-medium">
                        {scenario}
                      </div>
                      {data.dashboard.heatmap.themes.map((theme) => {
                        const cell = data.dashboard.heatmap.cells.find((item) => item.scenario === scenario && item.theme === theme.theme);
                        return (
                          <div
                            key={`${scenario}:${theme.theme}`}
                            className={`rounded-xl px-3 py-3 text-[12px] font-medium ${getHeatmapBackground(cell?.prevalence_pct ?? 0)}`}
                          >
                            <p>{cell?.prevalence_pct ?? 0}%</p>
                            <p className="mt-1 text-[10px] opacity-80">priority {Math.round(cell?.priority_score ?? 0)}</p>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-base font-semibold">Evidence Drawer</h2>
                <p className="text-[13px] text-muted-foreground">
                  Short anonymised examples you can lift into tutorials and debriefs.
                </p>
              </div>
              <Tabs defaultValue={data.dashboard.evidence_drawers[0]?.theme} className="space-y-4">
                <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                  {data.dashboard.evidence_drawers.map((drawer) => (
                    <TabsTrigger key={drawer.theme} value={drawer.theme}>
                      {drawer.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {data.dashboard.evidence_drawers.map((drawer) => (
                  <TabsContent key={drawer.theme} value={drawer.theme}>
                    <div className="grid gap-4 xl:grid-cols-3">
                      {drawer.examples.map((example, index) => (
                        <Card key={`${drawer.theme}:${index}`} className="border border-border/60">
                          <CardHeader className="border-b border-border/50">
                            <CardDescription>{example.scenario}</CardDescription>
                            <CardTitle className="text-sm">Example {index + 1}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3 pt-4">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Before</p>
                              <p className="mt-1 text-[13px] leading-relaxed">{example.before}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Learner Turn</p>
                              <p className="mt-1 text-[13px] leading-relaxed">{example.learner_turn}</p>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">After</p>
                              <p className="mt-1 text-[13px] leading-relaxed">{example.after}</p>
                            </div>
                            <div className="rounded-xl bg-muted/60 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Why It Matters</p>
                              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{example.why_it_matters}</p>
                            </div>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">Better Alternative</p>
                              <p className="mt-1 text-[13px] leading-relaxed text-emerald-800">{example.better_alternative}</p>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <Card className="border border-border/60">
                <CardHeader className="border-b border-border/50">
                  <CardTitle>What to Emphasise in the Next Tutorial</CardTitle>
                  <CardDescription>
                    Keep the next teaching block narrow enough that learners can practise these moves repeatedly.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {data.dashboard.action_panel.what_to_emphasise_in_the_next_tutorial.map((item, index) => (
                    <div key={item} className="flex gap-3 rounded-xl border border-border/60 bg-muted/30 p-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
                        {index + 1}
                      </div>
                      <p className="text-[13px] leading-relaxed">{item}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="border border-border/60">
                  <CardHeader className="border-b border-border/50">
                    <CardTitle>Cross-Cutting Patterns</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-5">
                    {data.report.cross_cutting_patterns.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">No strong cross-cutting pattern yet.</p>
                    ) : (
                      data.report.cross_cutting_patterns.map((item) => (
                        <div key={item} className="rounded-xl bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground">
                          {item}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card className="border border-border/60">
                  <CardHeader className="border-b border-border/50">
                    <CardTitle>Strengths to Build On</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-5">
                    {data.report.strengths_to_build_on.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">No robust strength signal yet.</p>
                    ) : (
                      data.report.strengths_to_build_on.map((item) => (
                        <div key={item} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] leading-relaxed text-emerald-800">
                          {item}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card className="border border-border/60">
                <CardHeader className="border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-amber-600" />
                    <CardTitle>Scenario Design Issues</CardTitle>
                  </div>
                  <CardDescription>
                    Flag these before turning them into pure teaching deficits.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {data.report.scenario_design_issues.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">No clear scenario-design issue detected from the current cohort evidence.</p>
                  ) : (
                    data.report.scenario_design_issues.map((item) => (
                      <div key={item} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900">
                        {item}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border border-border/60">
                <CardHeader className="border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <CardTitle>Data Quality Flags</CardTitle>
                  </div>
                  <CardDescription>
                    Read these before drawing strong conclusions from a small or incomplete slice.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-5">
                  {data.report.data_quality_flags.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">No major data-quality concern detected for this slice.</p>
                  ) : (
                    data.report.data_quality_flags.map((item) => (
                      <div key={item} className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] leading-relaxed text-red-900">
                        {item}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
