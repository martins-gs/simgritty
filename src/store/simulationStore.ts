import { create } from "zustand";
import type { TranscriptTurn, ClassifierResult, SimulationStateEvent } from "@/types/simulation";
import type { EscalationState } from "@/types/escalation";

type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

interface SimulationState {
  sessionId: string | null;
  connectionStatus: ConnectionStatus;
  micMuted: boolean;
  escalationLevel: number;
  escalationState: EscalationState | null;
  transcript: TranscriptTurn[];
  events: SimulationStateEvent[];
  elapsedSeconds: number;
  lastClassifierResult: ClassifierResult | null;

  // Actions
  setSessionId: (id: string) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  toggleMic: () => void;
  setMicMuted: (muted: boolean) => void;
  setEscalationLevel: (level: number) => void;
  setEscalationState: (state: EscalationState) => void;
  addTranscriptTurn: (turn: TranscriptTurn) => void;
  addEvent: (event: SimulationStateEvent) => void;
  setElapsedSeconds: (seconds: number) => void;
  setLastClassifierResult: (result: ClassifierResult) => void;
  reset: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  sessionId: null,
  connectionStatus: "idle",
  micMuted: false,
  escalationLevel: 3,
  escalationState: null,
  transcript: [],
  events: [],
  elapsedSeconds: 0,
  lastClassifierResult: null,

  setSessionId: (id) => set({ sessionId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  toggleMic: () => set((s) => ({ micMuted: !s.micMuted })),
  setMicMuted: (muted) => set({ micMuted: muted }),
  setEscalationLevel: (level) => set({ escalationLevel: level }),
  setEscalationState: (state) => set({ escalationState: state }),
  addTranscriptTurn: (turn) =>
    set((s) => ({ transcript: [...s.transcript, turn] })),
  addEvent: (event) => set((s) => ({ events: [...s.events, event] })),
  setElapsedSeconds: (seconds) => set({ elapsedSeconds: seconds }),
  setLastClassifierResult: (result) => set({ lastClassifierResult: result }),
  reset: () =>
    set({
      sessionId: null,
      connectionStatus: "idle",
      micMuted: false,
      escalationLevel: 3,
      escalationState: null,
      transcript: [],
      events: [],
      elapsedSeconds: 0,
      lastClassifierResult: null,
    }),
}));
