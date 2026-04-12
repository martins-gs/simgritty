"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Trash2 } from "lucide-react";

interface ScenarioItem {
  id: string;
  title: string;
  setting: string;
  difficulty: string;
  status: string;
  archetype_tag: string | null;
  created_by: string;
  created_at: string;
}

interface SessionItem {
  id: string;
  scenario_id: string;
  trainee_id: string;
  status: string;
  exit_type: string | null;
  final_escalation_level: number | null;
  peak_escalation_level: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  scenario_templates: { title: string } | null;
  trainee_name: string | null;
}

interface DashboardLoadResult {
  scenarios: ScenarioItem[];
  sessions: SessionItem[];
  hasMoreSessions: boolean;
  nextSessionOffset: number | null;
  userName: string | null;
  userId: string | null;
}

let dashboardLoadResultCache: DashboardLoadResult | null = null;
let dashboardLoadRequestCache: Promise<DashboardLoadResult> | null = null;
const DASHBOARD_SESSION_PAGE_SIZE = 20;

export default function DashboardPage() {
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);
  const [nextSessionOffset, setNextSessionOffset] = useState<number | null>(null);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (dashboardLoadResultCache) {
          if (!cancelled) {
            setScenarios(dashboardLoadResultCache.scenarios);
            setSessions(dashboardLoadResultCache.sessions);
            setUserName(dashboardLoadResultCache.userName);
            setUserId(dashboardLoadResultCache.userId);
          }
          return;
        }

        if (!dashboardLoadRequestCache) {
          dashboardLoadRequestCache = (async (): Promise<DashboardLoadResult> => {
            const [scenRes, sessRes, profileRes] = await Promise.all([
              fetch("/api/scenarios"),
              fetch(`/api/sessions/recent?limit=${DASHBOARD_SESSION_PAGE_SIZE}`),
              fetch("/api/profile"),
            ]);

            const result: DashboardLoadResult = {
              scenarios: [],
              sessions: [],
              hasMoreSessions: false,
              nextSessionOffset: null,
              userName: null,
              userId: null,
            };

            if (scenRes.ok) result.scenarios = (await scenRes.json()).slice(0, 6);
            if (sessRes.ok) {
              const sessionsPayload = await sessRes.json();
              result.sessions = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
              result.hasMoreSessions = Boolean(sessionsPayload?.hasMore);
              result.nextSessionOffset = typeof sessionsPayload?.nextOffset === "number"
                ? sessionsPayload.nextOffset
                : null;
            }
            if (profileRes.ok) {
              const profile = await profileRes.json();
              if (profile.display_name) result.userName = profile.display_name;
              if (profile.id) result.userId = profile.id;
            }

            return result;
          })().finally(() => {
            dashboardLoadRequestCache = null;
          });
        }

        const result = await dashboardLoadRequestCache;
        dashboardLoadResultCache = result;

        if (cancelled) return;

        setScenarios(result.scenarios);
        setSessions(result.sessions);
        setHasMoreSessions(result.hasMoreSessions);
        setNextSessionOffset(result.nextSessionOffset);
        setUserName(result.userName);
        setUserId(result.userId);
      } catch {
        if (!cancelled) {
          toast.error("Failed to load dashboard data");
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
  }, []);

  async function handleDeleteSession() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/sessions/${deleteTarget.id}/delete`, { method: "DELETE" });
    if (res.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      dashboardLoadResultCache = dashboardLoadResultCache
        ? {
            ...dashboardLoadResultCache,
            sessions: dashboardLoadResultCache.sessions.filter((s) => s.id !== deleteTarget.id),
          }
        : null;
      toast.success("Session deleted");
    } else {
      toast.error("Failed to delete session");
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function handleLoadMoreSessions() {
    if (loadingMoreSessions || nextSessionOffset == null) return;

    setLoadingMoreSessions(true);
    try {
      const res = await fetch(
        `/api/sessions/recent?limit=${DASHBOARD_SESSION_PAGE_SIZE}&offset=${nextSessionOffset}`
      );
      if (!res.ok) {
        toast.error("Failed to load older sessions");
        return;
      }

      const payload = await res.json();
      const nextSessions: SessionItem[] = Array.isArray(payload?.sessions) ? payload.sessions : [];
      const nextHasMore = Boolean(payload?.hasMore);
      const nextOffset = typeof payload?.nextOffset === "number" ? payload.nextOffset : null;

      setSessions((prev) => {
        const seen = new Set(prev.map((session) => session.id));
        const merged = [...prev];
        for (const session of nextSessions) {
          if (!seen.has(session.id)) {
            merged.push(session);
            seen.add(session.id);
          }
        }
        dashboardLoadResultCache = dashboardLoadResultCache
          ? {
              ...dashboardLoadResultCache,
              sessions: merged,
              hasMoreSessions: nextHasMore,
              nextSessionOffset: nextOffset,
            }
          : null;
        return merged;
      });
      setHasMoreSessions(nextHasMore);
      setNextSessionOffset(nextOffset);
    } catch {
      toast.error("Failed to load older sessions");
    } finally {
      setLoadingMoreSessions(false);
    }
  }

  const publishedScenarios = scenarios.filter((s) => s.status === "published");

  const formatSessionDateTime = (session: SessionItem) => {
    const rawTimestamp = session.started_at ?? session.ended_at ?? session.created_at;
    const parsedTimestamp = Date.parse(rawTimestamp);
    if (Number.isNaN(parsedTimestamp)) {
      return null;
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsedTimestamp);
  };

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-lg font-semibold">
            {userName ? `Welcome, ${userName}` : "Dashboard"}
          </h1>
        </div>

        {/* Scenarios available to you */}
        <section className="rounded-xl bg-muted/40 border border-border/40 p-5">
          <div className="mb-4">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Scenarios available to you</h2>
          </div>
          {loading ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Loading...</p>
          ) : publishedScenarios.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 bg-card py-10 text-center">
              <p className="text-[13px] text-muted-foreground">No scenarios available yet</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {publishedScenarios.map((s) => (
                <Link
                  key={s.id}
                  href={`/scenarios/${s.id}/briefing`}
                  className="group relative w-[220px] rounded-xl border border-border/60 bg-card p-4 shadow-sm transition-colors hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[11px] text-muted-foreground capitalize">{s.difficulty}</span>
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Play className="h-3 w-3" />
                    </div>
                  </div>
                  <p className="text-[13px] font-medium leading-snug">{s.title}</p>
                  {s.setting && (
                    <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{s.setting}</p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <section>
            <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent sessions
            </h2>
            <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
              {sessions.map((s) => {
                const sessionDateTime = formatSessionDateTime(s);

                return (
                  <div key={s.id} className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-accent/40">
                    <Link href={`/review/${s.id}`} className="flex-1 min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {s.scenario_templates?.title ?? "Untitled"}
                      </p>
                      {s.trainee_name && (
                        <p className="text-[11px] text-muted-foreground">{s.trainee_name}</p>
                      )}
                      {sessionDateTime && (
                        <p className="text-[11px] text-muted-foreground">
                          {sessionDateTime}
                        </p>
                      )}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {s.peak_escalation_level != null && (
                        <span className="text-[11px] text-muted-foreground">Peak {s.peak_escalation_level}</span>
                      )}
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          s.status === "completed"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : s.status === "aborted"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : ""
                        }`}
                      >
                        {s.exit_type === "instant_exit" ? "exited" : s.status}
                      </Badge>
                      {userId && s.trainee_id === userId && (
                        <button
                          onClick={(e) => { e.preventDefault(); setDeleteTarget(s); }}
                          className="ml-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                          aria-label="Delete session"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {hasMoreSessions && (
              <div className="mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMoreSessions}
                  disabled={loadingMoreSessions}
                >
                  {loadingMoreSessions ? "Loading older sessions..." : "Load older sessions"}
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Delete session confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session</DialogTitle>
            <DialogDescription>
              This will permanently delete the session for &ldquo;{deleteTarget?.scenario_templates?.title}&rdquo; including its transcript, events, and notes. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="text-[13px]" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteSession} disabled={deleting} className="text-[13px]">
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
