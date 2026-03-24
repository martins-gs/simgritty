"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { TranscriptViewer } from "@/components/review/TranscriptViewer";
import { EscalationTimeline } from "@/components/review/EscalationTimeline";
import { EventLog } from "@/components/review/EventLog";
import { EducatorNotes } from "@/components/review/EducatorNotes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptTurn, SimulationStateEvent, EducatorNote, SimulationSession } from "@/types/simulation";

export default function ReviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [events, setEvents] = useState<SimulationStateEvent[]>([]);
  const [notes, setNotes] = useState<EducatorNote[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [sessionRes, turnsRes, eventsRes, notesRes] = await Promise.all([
        fetch(`/api/sessions/${sessionId}`),
        fetch(`/api/sessions/${sessionId}/transcript`),
        fetch(`/api/sessions/${sessionId}/events`),
        fetch(`/api/sessions/${sessionId}/educator-notes`),
      ]);

      if (sessionRes.ok) setSession(await sessionRes.json());
      if (turnsRes.ok) setTurns(await turnsRes.json());
      if (eventsRes.ok) setEvents(await eventsRes.json());
      if (notesRes.ok) setNotes(await notesRes.json());
      setLoading(false);
    }
    load();
  }, [sessionId]);

  if (loading || !session) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Loading review...
        </div>
      </AppShell>
    );
  }

  const scenarioTitle =
    (session as unknown as { scenario_templates?: { title?: string } })
      .scenario_templates?.title || "Simulation";

  const duration = session.started_at && session.ended_at
    ? Math.round(
        (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000
      )
    : null;

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">{scenarioTitle}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={session.status === "completed" ? "default" : "destructive"}>
              {session.exit_type === "instant_exit" ? "Exited early" : session.status}
            </Badge>
            {session.peak_escalation_level && (
              <Badge variant="outline">
                Peak escalation: {session.peak_escalation_level}
              </Badge>
            )}
            {session.final_escalation_level && (
              <Badge variant="outline">
                Final: {session.final_escalation_level}
              </Badge>
            )}
            {duration && (
              <Badge variant="secondary">{formatDuration(duration)}</Badge>
            )}
            {session.started_at && (
              <Badge variant="secondary">
                {new Date(session.started_at).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Turns</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{turns.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Events</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{events.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Peak Level</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{session.peak_escalation_level ?? "N/A"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Exit Type</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold capitalize">
                {session.exit_type?.replace(/_/g, " ") ?? "N/A"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="transcript">
          <TabsList>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="timeline">Escalation Timeline</TabsTrigger>
            <TabsTrigger value="events">Event Log</TabsTrigger>
            <TabsTrigger value="notes">Educator Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="transcript" className="mt-4">
            <Card>
              <CardContent className="p-0 h-[500px]">
                <TranscriptViewer
                  turns={turns}
                  onTurnSelect={setSelectedTurnId}
                  selectedTurnId={selectedTurnId}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Escalation Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                {session.started_at ? (
                  <EscalationTimeline
                    events={events}
                    maxCeiling={
                      (session.scenario_snapshot as { escalation_rules?: { max_ceiling?: number } })
                        ?.escalation_rules?.max_ceiling ?? 8
                    }
                    sessionStartedAt={session.started_at}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">No timeline data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <Card>
              <CardContent className="p-0 h-[500px]">
                <EventLog
                  events={events}
                  sessionStartedAt={session.started_at || session.created_at}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-4">
            <Card>
              <CardContent className="p-0 h-[500px]">
                <EducatorNotes
                  sessionId={sessionId}
                  notes={notes}
                  onNoteAdded={(note) => setNotes((prev) => [...prev, note])}
                  selectedTurnId={selectedTurnId}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
