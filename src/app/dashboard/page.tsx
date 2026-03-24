"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Play, Trash2 } from "lucide-react";

interface ScenarioItem {
  id: string;
  title: string;
  difficulty: string;
  status: string;
  archetype_tag: string | null;
  created_at: string;
}

interface SessionItem {
  id: string;
  scenario_id: string;
  status: string;
  exit_type: string | null;
  final_escalation_level: number | null;
  peak_escalation_level: number | null;
  started_at: string | null;
  ended_at: string | null;
  scenario_templates: { title: string } | null;
}

export default function DashboardPage() {
  const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const [scenRes, sessRes] = await Promise.all([
        fetch("/api/scenarios"),
        fetch("/api/sessions/recent"),
      ]);
      if (scenRes.ok) setScenarios((await scenRes.json()).slice(0, 6));
      if (sessRes.ok) setSessions(await sessRes.json());
      setLoading(false);
    }
    load();
  }, []);

  async function handleDeleteSession() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/sessions/${deleteTarget.id}/delete`, { method: "DELETE" });
    if (res.ok) {
      setSessions((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      toast.success("Session deleted");
    } else {
      toast.error("Failed to delete session");
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  const publishedScenarios = scenarios.filter((s) => s.status === "published");

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-lg font-semibold">Dashboard</h1>
        </div>

        {/* Quick start */}
        {publishedScenarios.length > 0 && (
          <section>
            <h2 className="mb-3 text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
              Start a simulation
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {publishedScenarios.map((s) => (
                <Link
                  key={s.id}
                  href={`/scenarios/${s.id}/briefing`}
                  className="group flex items-center justify-between rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:border-primary/30 hover:bg-accent/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{s.title}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{s.difficulty}</p>
                  </div>
                  <div className="ml-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Play className="h-3.5 w-3.5" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Recent scenarios */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Scenarios</h2>
            <Link href="/scenarios/new" className="flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" />New
            </Link>
          </div>
          {loading ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">Loading...</p>
          ) : scenarios.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/80 py-10 text-center">
              <p className="text-[13px] text-muted-foreground">No scenarios yet</p>
              <Link href="/scenarios/new" className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                <Plus className="h-3.5 w-3.5" />Create your first scenario
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
              {scenarios.map((s) => (
                <Link key={s.id} href={`/scenarios/${s.id}`} className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-accent/40">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="truncate text-[13px] font-medium">{s.title}</span>
                    <Badge variant={s.status === "published" ? "default" : "secondary"} className="text-[10px] shrink-0">{s.status}</Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground capitalize shrink-0 ml-3">{s.difficulty}</span>
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
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-accent/40">
                  <Link href={`/review/${s.id}`} className="flex-1 min-w-0">
                    <span className="truncate text-[13px] font-medium">
                      {s.scenario_templates?.title ?? "Untitled"}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {s.peak_escalation_level != null && (
                      <span className="text-[11px] text-muted-foreground">Peak {s.peak_escalation_level}</span>
                    )}
                    <Badge
                      variant={s.status === "completed" ? "default" : s.status === "aborted" ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {s.exit_type === "instant_exit" ? "exited" : s.status}
                    </Badge>
                    <button
                      onClick={(e) => { e.preventDefault(); setDeleteTarget(s); }}
                      className="ml-1 flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Delete confirmation dialog */}
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
