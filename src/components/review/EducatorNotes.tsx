"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send } from "lucide-react";
import type { EducatorNote } from "@/types/simulation";

interface EducatorNotesProps {
  sessionId: string;
  notes: EducatorNote[];
  onNoteAdded: (note: EducatorNote) => void;
  selectedTurnId?: string | null;
}

export function EducatorNotes({
  sessionId,
  notes,
  onNoteAdded,
  selectedTurnId,
}: EducatorNotesProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);

    const res = await fetch(`/api/sessions/${sessionId}/educator-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: content.trim(),
        turn_id: selectedTurnId || null,
      }),
    });

    if (res.ok) {
      toast.success("Note added");
      onNoteAdded({
        id: crypto.randomUUID(),
        session_id: sessionId,
        author_id: "",
        content: content.trim(),
        turn_id: selectedTurnId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setContent("");
    } else {
      toast.error("Failed to save note");
    }
    setSubmitting(false);
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No notes yet. Add your observations below.
            </p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-md border p-3">
                <p className="text-sm">{note.content}</p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{new Date(note.created_at).toLocaleString()}</span>
                  {note.turn_id && <span>Linked to turn</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <div className="border-t p-4">
        {selectedTurnId && (
          <p className="mb-2 text-xs text-muted-foreground">
            Linking note to selected transcript turn
          </p>
        )}
        <div className="flex gap-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Add an observation or note..."
            rows={2}
            className="flex-1"
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
