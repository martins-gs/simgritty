"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSimulationStore } from "@/store/simulationStore";
import {
  type TraineeAudioSegment,
  type TraineeTranscriptMeta,
  useRealtimeSession,
} from "@/hooks/useRealtimeSession";
import { useRealtimeVoiceRenderer } from "@/hooks/useRealtimeVoiceRenderer";
import { useSessionRecorder } from "@/hooks/useSessionRecorder";
import { convertAudioBlobToWavBase64 } from "@/lib/audio/wav";
import { EscalationEngine } from "@/lib/engine/escalationEngine";
import { buildPrompt } from "@/lib/engine/promptBuilder";
import {
  buildClinicianRealtimeInstructions,
  buildClinicianRealtimeInstructionsFromProfile,
  type ClinicianVoiceContext,
} from "@/lib/engine/clinicianVoiceBuilder";
import { Waveform } from "@/components/simulation/Waveform";
import { LiveTranscript, type TranscriptEntry } from "@/components/simulation/LiveTranscript";
import { Mic, MicOff, Square, Bot, Hand } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { EscalationState } from "@/types/escalation";
import { ESCALATION_LABELS } from "@/types/escalation";
import {
  DEFAULT_ESCALATION_RULES,
  DEFAULT_TRAITS,
  DEFAULT_VOICE_CONFIG,
} from "@/types/scenario";
import type {
  ClassifierResult,
  ClinicianAudioOutcome,
  ClinicianAudioPath,
  SimulationSession,
  SimulationStateEvent,
  Speaker,
  TraineeDeliveryAnalysis,
  TranscriptTurn,
  TurnTriggerType,
} from "@/types/simulation";
import type { StructuredVoiceProfile } from "@/types/voice";
import {
  parseClassifierResult,
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseStructuredVoiceProfile,
  parseTraineeDeliveryAnalysis,
  parseTranscriptTurns,
  type ValidatedScenarioSnapshot,
} from "@/lib/validation/schemas";

function escColor(level: number) {
  if (level <= 2) return { bar: "bg-emerald-500", text: "text-emerald-600", ring: "ring-emerald-500/20" };
  if (level <= 4) return { bar: "bg-amber-500", text: "text-amber-600", ring: "ring-amber-500/20" };
  if (level <= 6) return { bar: "bg-orange-500", text: "text-orange-600", ring: "ring-orange-500/20" };
  if (level <= 8) return { bar: "bg-red-500", text: "text-red-600", ring: "ring-red-500/20" };
  return { bar: "bg-red-700", text: "text-red-700", ring: "ring-red-700/20" };
}

const CLINICIAN_REALTIME_VOICE = "cedar";
const CLINICIAN_REALTIME_HANDOFF_DELAY_MS = 25;
const CLINICIAN_REALTIME_PARTIAL_TAIL_GUARD_MS = 2500;
const BOT_TURN_POST_PATIENT_DELAY_MS = 600;
const BOT_RESPONSE_CANCEL_SETTLE_MS = 40;
const BOT_PATIENT_AUDIO_CLEAR_WAIT_MS = 250;
const PATIENT_TURN_COMPLETION_TIMEOUT_MS = 7000;

interface PreparedBotTurn {
  text: string;
  technique: string;
  voiceProfile: StructuredVoiceProfile | null;
}

interface BotTurnRequestOptions {
  patientVoiceProfile?: StructuredVoiceProfile | null;
  recentTurns?: { speaker: string; content: string }[];
  signal?: AbortSignal;
  snapshot?: ValidatedScenarioSnapshot | null;
  state?: ReturnType<EscalationEngine["getState"]> | null;
  seed?: number | null;
  reason?: string;
}

interface PersistedTurnSnapshot {
  classifierResult: ClassifierResult | null;
  traineeDeliveryAnalysis: TraineeDeliveryAnalysis | null;
  triggerType: TurnTriggerType | null;
  stateAfter: EscalationState;
  patientVoiceProfileAfter: StructuredVoiceProfile | null;
  patientPromptAfter: string | null;
}

interface PendingTurnCompletion {
  promise: Promise<void>;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ClinicianAudioResult {
  path: ClinicianAudioPath;
  realtimeOutcome: ClinicianAudioOutcome | null;
  fallbackReason: string | null;
  rendererError: string | null;
  elapsedMs: number | null;
}

interface PatientReplyUpdateResult {
  snapshot: PersistedTurnSnapshot | null;
  stateAfter: EscalationState;
  triggerType: TurnTriggerType;
  classifierResult: ClassifierResult;
  recentTurnsForPrompt: { speaker: string; content: string }[];
}

interface SessionEventInput {
  event_index: number;
  event_type: string;
  escalation_before?: number | null;
  escalation_after?: number | null;
  trust_before?: number | null;
  trust_after?: number | null;
  listening_before?: number | null;
  listening_after?: number | null;
  payload?: Record<string, unknown>;
}

interface PendingTraineeAudioAnalysisTurn {
  turnIndex: number;
  utterance: string;
  scenarioContext: string;
  currentEscalation: number;
  recentTurns: { speaker: string; content: string }[];
  classifierResult: ClassifierResult;
  snapshot: PersistedTurnSnapshot;
  durationMs: number | null;
  turnPersistPromise: Promise<unknown> | null;
}

const FALLBACK_BOT_TURN: PreparedBotTurn = {
  text: "I can see this is a difficult situation. Let me help.",
  technique: "general de-escalation",
  voiceProfile: null,
};

export default function SimulationPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const {
    connect,
    disconnect,
    updateSession,
    setTurnDetection,
    cancelCurrentResponse,
    setMicEnabled,
    setMicForcedOff,
    sendEvent,
    audioElRef,
    localStreamRef,
  } = useRealtimeSession();
  const {
    connect: connectClinicianRenderer,
    disconnect: disconnectClinicianRenderer,
    speakText: speakWithClinicianRenderer,
  } = useRealtimeVoiceRenderer();

  const {
    start: startRecording,
    addRemoteStream: addRecordingRemoteStream,
    stop: stopRecording,
    dispose: disposeRecorder,
    getStartedAt: getRecordingStartedAt,
  } = useSessionRecorder();

  const connectionStatus = useSimulationStore((s) => s.connectionStatus);
  const micMuted = useSimulationStore((s) => s.micMuted);
  const toggleMic = useSimulationStore((s) => s.toggleMic);

  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [currentAiText, setCurrentAiText] = useState("");
  const [escalationLevel, setEscalationLevel] = useState(3);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [maxCeiling, setMaxCeiling] = useState(8);
  const [scenarioLoaded, setScenarioLoaded] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [botActive, setBotActive] = useState(false);
  const [botSpeaking, setBotSpeaking] = useState(false);
  const [mobileTab, setMobileTab] = useState<"simulation" | "transcript" | "scenario">("simulation");

  const engineRef = useRef<EscalationEngine | null>(null);
  const turnIndexRef = useRef(0);
  const eventIndexRef = useRef(1);
  const peakLevelRef = useRef(3);
  const scenarioRef = useRef<ValidatedScenarioSnapshot | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const aiSpeakingRef = useRef(false);
  const pendingUpdateRef = useRef<string | null>(null);
  const classifyingRef = useRef(false);
  const classifyDoneRef = useRef<Promise<void>>(Promise.resolve());
  const endingRef = useRef(false);
  const botActiveRef = useRef(false);
  const botAbortRef = useRef<AbortController | null>(null);
  const patientVoiceProfileRef = useRef<StructuredVoiceProfile | null>(null);
  const patientPromptRef = useRef<string | null>(null);
  const completedMilestonesRef = useRef<Set<string>>(new Set());
  const patientVoiceRequestRef = useRef(0);
  const pendingPatientReplyUpdateRef = useRef<Promise<PatientReplyUpdateResult | null> | null>(null);
  const patientReplyUpdateRequestRef = useRef(0);
  const pendingPersistenceRef = useRef<Set<Promise<unknown>>>(new Set());
  const clinicianRendererReadyRef = useRef(false);
  const clinicianRendererConnectRef = useRef<Promise<boolean> | null>(null);
  const clinicianRendererErrorRef = useRef<string | null>(null);
  const pendingBotTurnRef = useRef<Promise<PreparedBotTurn | null> | null>(null);
  const pendingBotTurnRequestRef = useRef(0);
  const pendingBotTurnSeedRef = useRef<number | null>(null);
  const lastClinicianVoiceProfileRef = useRef<StructuredVoiceProfile | null>(null);
  const pendingPatientTurnCompletionRef = useRef<PendingTurnCompletion | null>(null);
  const maxSessionDurationSecondsRef = useRef<number>(10 * 60);
  const pendingTraineeAudioAnalysisTurnsRef = useRef<Map<string, PendingTraineeAudioAnalysisTurn>>(new Map());
  const pendingTraineeAudioSegmentsRef = useRef<Map<string, TraineeAudioSegment>>(new Map());
  const inFlightTraineeAudioAnalysisRef = useRef<Set<string>>(new Set());

  useEffect(() => { transcriptRef.current = transcriptEntries; }, [transcriptEntries]);

  // Enforce max session duration
  useEffect(() => {
    if (!scenarioLoaded || endingRef.current) return;
    if (elapsed >= maxSessionDurationSecondsRef.current) {
      toast.warning("Maximum session duration reached");
      handleEndSession("max_duration");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, scenarioLoaded]);

  // Close the session if the user closes the tab or hard-refreshes.
  // sendBeacon is guaranteed to be dispatched even as the page tears down.
  useEffect(() => {
    function handleUnload() {
      if (endingRef.current) return;
      navigator.sendBeacon(
        `/api/sessions/${sessionId}/end`,
        new Blob(
          [JSON.stringify({ exit_type: "instant_exit", peak_escalation_level: peakLevelRef.current })],
          { type: "application/json" }
        )
      );
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [sessionId]);

  // Poll for audio element from hook (it's created async during connect)
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioElRef.current && audioElRef.current !== audioElement) {
        setAudioElement(audioElRef.current);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [audioElRef, audioElement]);

  useEffect(() => {
    const abortController = new AbortController();
    let cancelled = false;

    async function init() {
      try {
        const sessionRes = await fetch(`/api/sessions/${sessionId}`, { signal: abortController.signal });
        if (cancelled) return;
        if (!sessionRes.ok) { router.push("/dashboard"); return; }

        const session = await readJsonSafely(sessionRes, parseSimulationSession, null, "session");
        if (cancelled) return;
        if (!session) { router.push("/dashboard"); return; }
        const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
        scenarioRef.current = snapshot;

        const [persistedTurns, persistedEvents, forkHistory] = await Promise.all([
          fetchSessionTurns(sessionId, abortController.signal),
          fetchSessionEvents(sessionId, abortController.signal),
          loadForkHistory(session, abortController.signal),
        ]);
        if (cancelled) return;

        const { traits, voiceConfig, escalationRules } = getScenarioConfig(snapshot);

        // Fetch org ceiling so the scenario cap respects the org-wide limit
        let orgCeiling = 10;
        try {
          const orgRes = await fetch("/api/org-settings", { signal: abortController.signal });
          if (orgRes.ok) {
            const orgData = await orgRes.json();
            if (orgData?.max_escalation_ceiling) orgCeiling = orgData.max_escalation_ceiling;
            if (orgData?.max_session_duration_minutes) maxSessionDurationSecondsRef.current = orgData.max_session_duration_minutes * 60;
          }
        } catch {
          // Non-fatal — fall back to 10
        }
        if (cancelled) return;

        const ceiling = Math.min(escalationRules.max_ceiling, orgCeiling);
        setMaxCeiling(ceiling);

        const engine = new EscalationEngine(escalationRules, traits, ceiling);
        engineRef.current = engine;

        const inheritedTurns = forkHistory.inheritedTurns;
        const allTurns = [...inheritedTurns, ...persistedTurns];
        const inheritedEntries = allTurns.map<TranscriptEntry>((turn) => ({
          speaker: turn.speaker,
          content: turn.content,
          timestamp: turn.started_at,
        }));
        transcriptRef.current = inheritedEntries;
        setTranscriptEntries(inheritedEntries);
        turnIndexRef.current = persistedTurns.length;

        const currentEventIndex =
          persistedEvents.length > 0
            ? Math.max(...persistedEvents.map((event) => event.event_index)) + 1
            : 1;
        eventIndexRef.current = currentEventIndex;

        const latestCurrentSnapshot = [...persistedTurns]
          .reverse()
          .map((turn) => getPersistedSnapshotFromTurn(turn))
          .find((turn): turn is PersistedTurnSnapshot => turn !== null);
        const resumeSnapshot = latestCurrentSnapshot ?? forkHistory.resumeSnapshot;

        if (resumeSnapshot) {
          engine.hydrateState(resumeSnapshot.stateAfter);
          patientVoiceProfileRef.current = resumeSnapshot.patientVoiceProfileAfter;
          patientPromptRef.current = resumeSnapshot.patientPromptAfter;
        }

        setEscalationLevel(engine.getLevel());
        peakLevelRef.current = allTurns.reduce((peak, turn) => {
          const level = turn.state_after?.level ?? peak;
          return Math.max(peak, level);
        }, engine.getLevel());

        // Recover completed milestones from persisted turns so the classifier
        // doesn't re-flag already-completed milestones on session resume
        for (const turn of allTurns) {
          const milestoneId = turn.classifier_result?.clinical_milestone_completed;
          if (milestoneId) completedMilestonesRef.current.add(milestoneId);
        }

        const recentTurns = inheritedEntries
          .slice(-20)
          .map((entry) => ({ speaker: entry.speaker, content: entry.content }));

        const resolvedInstructions = patientPromptRef.current
          ?? await resolvePatientInstructions(
            snapshot,
            engine.getState(),
            recentTurns,
            patientVoiceProfileRef.current,
            abortController.signal
          );
        const instructions =
          resolvedInstructions
          ?? buildPatientInstructions(snapshot, engine.getState(), recentTurns, patientVoiceProfileRef.current);
        patientPromptRef.current = instructions;

        if (cancelled) return;
        const started = await startSession(abortController.signal);
        if (!started) {
          console.warn(`[Simulation Init] Continuing without confirmed session start for session=${sessionId}`);
        }

        await connect({
          voice: voiceConfig.voice_name || "marin", instructions,
          onTraineeTranscript: handleTraineeTranscript,
          onTraineeAudioSegment: handleTraineeAudioSegment,
          onAiTranscript: handleAiTranscriptDone,
          onAiTranscriptDelta: handleAiDelta,
          onAiPlaybackComplete: handleAiPlaybackComplete,
          onAiPlaybackSafetyTimeout: handleAiPlaybackSafetyTimeout,
          onError: (err) => console.error("Realtime error:", err),
        });
        if (cancelled) { disconnect(); return; }

        // Start continuous audio recording (mixed mic + AI)
        const localStream = localStreamRef.current;
        const remoteStream = audioElRef.current?.srcObject as MediaStream | null;
        if (localStream) {
          startRecording(localStream, remoteStream);
          // If the remote stream hasn't arrived yet, add it when the audio
          // element gets a source (the ontrack handler sets srcObject async).
          if (!remoteStream) {
            const pollRemote = setInterval(() => {
              const rs = audioElRef.current?.srcObject as MediaStream | null;
              if (rs && rs.getAudioTracks().length > 0) {
                clearInterval(pollRemote);
                addRecordingRemoteStream(rs);
              }
            }, 200);
            // Stop polling after 30s to avoid leaks
            setTimeout(() => clearInterval(pollRemote), 30_000);
          }
        }

        const baseElapsed = session.started_at
          ? Math.max(0, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000))
          : 0;
        setElapsed(baseElapsed);
        setScenarioLoaded(true);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      } catch (err) {
        if (abortController.signal.aborted || cancelled) return;
        console.error("Simulation init error:", err);
        router.push("/dashboard");
      }
    }
    init();
    return () => {
      cancelled = true;
      abortController.abort();
      if (timerRef.current) clearInterval(timerRef.current);
      disconnect();
      disposeRecorder();
      // End the session on SPA navigation (component unmount) if not already ending
      if (!endingRef.current) {
        fetch(`/api/sessions/${sessionId}/end`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ exit_type: "instant_exit", peak_escalation_level: peakLevelRef.current }),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function getScenarioConfig(snapshot: ValidatedScenarioSnapshot) {
    return {
      traits: snapshot.scenario_traits[0] ?? DEFAULT_TRAITS,
      voiceConfig: snapshot.scenario_voice_config[0] ?? DEFAULT_VOICE_CONFIG,
      escalationRules: snapshot.escalation_rules[0] ?? DEFAULT_ESCALATION_RULES,
    };
  }

  function appendTranscriptEntry(entry: TranscriptEntry) {
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscriptEntries((prev) => [...prev, entry]);
  }

  function trackPersistence<T>(promise: Promise<T>) {
    pendingPersistenceRef.current.add(promise);
    void promise.finally(() => {
      pendingPersistenceRef.current.delete(promise);
    });
    return promise;
  }

  async function flushPendingPersistence(timeoutMs: number = 2500) {
    const pending = Array.from(pendingPersistenceRef.current);
    if (pending.length === 0) return;

    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async function persistRequest(
    label: string,
    input: RequestInfo | URL,
    init: RequestInit
  ) {
    const res = await fetch(input, init).catch((error) => {
      console.error(`[Persistence] ${label} request failed`, error);
      return null;
    });

    if (!res) return null;
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(`[Persistence] ${label} failed status=${res.status}`, errorText);
    }

    return res;
  }

  function persistSessionEvent(event: SessionEventInput) {
    void trackPersistence(
      persistRequest(
        `event ${event.event_type}`,
        `/api/sessions/${sessionId}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            escalation_before: null,
            escalation_after: null,
            trust_before: null,
            trust_after: null,
            listening_before: null,
            listening_after: null,
            payload: {},
            ...event,
          }),
        }
      )
    );
  }

  function persistTranscriptTurn(
    turnIndex: number,
    speaker: Speaker,
    content: string,
    snapshot: PersistedTurnSnapshot,
    timestamp?: string,
    durationMs?: number | null
  ) {
    return trackPersistence(
      persistRequest(
        `transcript turn ${turnIndex} ${speaker}`,
        `/api/sessions/${sessionId}/transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            turn_index: turnIndex,
            speaker,
            content,
            classifier_result: snapshot.classifierResult,
            trainee_delivery_analysis: snapshot.traineeDeliveryAnalysis,
            trigger_type: snapshot.triggerType,
            state_after: snapshot.stateAfter,
            patient_voice_profile_after: snapshot.patientVoiceProfileAfter,
            patient_prompt_after: snapshot.patientPromptAfter,
            started_at: timestamp,
            duration_ms: durationMs ?? null,
          }),
        }
      )
    );
  }

  function updatePersistedTurnSnapshot(
    turnIndex: number,
    snapshot: PersistedTurnSnapshot
  ) {
    return trackPersistence(
      persistRequest(
        `transcript patch ${turnIndex}`,
        `/api/sessions/${sessionId}/transcript`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            turn_index: turnIndex,
            classifier_result: snapshot.classifierResult,
            trainee_delivery_analysis: snapshot.traineeDeliveryAnalysis,
            trigger_type: snapshot.triggerType,
            state_after: snapshot.stateAfter,
            patient_voice_profile_after: snapshot.patientVoiceProfileAfter,
            patient_prompt_after: snapshot.patientPromptAfter,
          }),
        }
      )
    );
  }

  function updatePersistedTurnDeliveryAnalysis(
    turnIndex: number,
    classifierResult: ClassifierResult | null,
    traineeDeliveryAnalysis: TraineeDeliveryAnalysis
  ) {
    return trackPersistence(
      persistRequest(
        `transcript audio patch ${turnIndex}`,
        `/api/sessions/${sessionId}/transcript`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            turn_index: turnIndex,
            classifier_result: classifierResult,
            trainee_delivery_analysis: traineeDeliveryAnalysis,
          }),
        }
      )
    );
  }

  function buildSnapshot(
    overrides: Partial<PersistedTurnSnapshot> = {}
  ): PersistedTurnSnapshot | null {
    const currentState = overrides.stateAfter ?? engineRef.current?.getState();
    if (!currentState) return null;

    return {
      classifierResult: overrides.classifierResult ?? null,
      traineeDeliveryAnalysis:
        overrides.traineeDeliveryAnalysis
        ?? overrides.classifierResult?.trainee_delivery_analysis
        ?? null,
      triggerType: overrides.triggerType ?? null,
      stateAfter: currentState,
      patientVoiceProfileAfter:
        overrides.patientVoiceProfileAfter ?? patientVoiceProfileRef.current,
      patientPromptAfter: overrides.patientPromptAfter ?? patientPromptRef.current,
    };
  }

  function getPersistedSnapshotFromTurn(turn: TranscriptTurn | null | undefined): PersistedTurnSnapshot | null {
    if (!turn?.state_after) return null;

    return {
      classifierResult: turn.classifier_result,
      traineeDeliveryAnalysis: turn.trainee_delivery_analysis,
      triggerType: turn.trigger_type,
      stateAfter: turn.state_after,
      patientVoiceProfileAfter: turn.patient_voice_profile_after,
      patientPromptAfter: turn.patient_prompt_after,
    };
  }

  async function readJsonSafely<T>(
    res: Response,
    parser: (data: unknown) => T,
    fallback: T,
    label: string
  ): Promise<T> {
    try {
      return parser(await res.json());
    } catch (error) {
      console.error(`[Simulation] Failed to parse ${label} response`, error);
      return fallback;
    }
  }

  function maybeStartTraineeAudioAnalysis(itemId: string) {
    const turn = pendingTraineeAudioAnalysisTurnsRef.current.get(itemId);
    const segment = pendingTraineeAudioSegmentsRef.current.get(itemId);
    if (!turn || !segment || inFlightTraineeAudioAnalysisRef.current.has(itemId)) {
      return;
    }

    inFlightTraineeAudioAnalysisRef.current.add(itemId);
    pendingTraineeAudioAnalysisTurnsRef.current.delete(itemId);
    pendingTraineeAudioSegmentsRef.current.delete(itemId);

    void trackPersistence((async () => {
      try {
        if (turn.turnPersistPromise) {
          await turn.turnPersistPromise.catch(() => null);
        }

        const audioBase64 = await convertAudioBlobToWavBase64(segment.blob);
        const res = await fetch("/api/analysis/trainee-delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            utterance: turn.utterance,
            scenarioContext: turn.scenarioContext,
            currentEscalation: turn.currentEscalation,
            recentTurns: turn.recentTurns,
            audioBase64,
            durationMs: turn.durationMs ?? segment.durationMs ?? null,
          }),
        }).catch((error) => {
          console.error("[Simulation] Trainee audio analysis request failed", error);
          return null;
        });

        if (!res || !res.ok) {
          const errorText = res ? await res.text().catch(() => "") : "";
          console.warn(
            `[Simulation] Trainee audio analysis request rejected item_id=${itemId} status=${res?.status ?? "network"}`,
            errorText
          );
          return;
        }

        const deliveryAnalysis = await readJsonSafely(
          res,
          (raw) => {
            if (typeof raw !== "object" || raw === null || !("deliveryAnalysis" in raw)) {
              return null;
            }
            return parseTraineeDeliveryAnalysis((raw as Record<string, unknown>).deliveryAnalysis);
          },
          null,
          "trainee delivery analysis"
        );
        if (!deliveryAnalysis) {
          console.warn(
            `[Simulation] Trainee audio analysis returned no structured result item_id=${itemId}`
          );
          return;
        }

        const nextSnapshot: PersistedTurnSnapshot = {
          ...turn.snapshot,
          traineeDeliveryAnalysis: deliveryAnalysis,
          classifierResult: {
            ...turn.classifierResult,
            trainee_delivery_analysis: deliveryAnalysis,
          },
        };

        const audioAnalysisEventIndex = eventIndexRef.current++;
        persistSessionEvent({
          event_index: audioAnalysisEventIndex,
          event_type: "classification_result",
          payload: {
            __event_kind: "trainee_audio_delivery",
            source: "trainee_audio_delivery",
            item_id: itemId,
            turn_index: turn.turnIndex,
            delivery_analysis: deliveryAnalysis,
          },
        });

        const patchRes = await updatePersistedTurnDeliveryAnalysis(
          turn.turnIndex,
          nextSnapshot.classifierResult,
          deliveryAnalysis
        );
        if (!patchRes?.ok) {
          console.warn(
            `[Simulation] Trainee audio analysis patch failed item_id=${itemId} turn_index=${turn.turnIndex} status=${patchRes?.status ?? "network"}`
          );
          return;
        }
        const patchAck = await readJsonSafely(
          patchRes,
          (raw) => {
            if (typeof raw !== "object" || raw === null) {
              return null;
            }
            const record = raw as Record<string, unknown>;
            return {
              hasTraineeDeliveryAnalysis: record.hasTraineeDeliveryAnalysis === true,
              markers: Array.isArray(record.markers)
                ? record.markers.filter((value): value is string => typeof value === "string")
                : [],
            };
          },
          null,
          "transcript patch acknowledgement"
        );
        if (!patchAck?.hasTraineeDeliveryAnalysis) {
          console.warn(
            `[Simulation] Trainee audio analysis patch acknowledged without stored delivery item_id=${itemId} turn_index=${turn.turnIndex}`
          );
          return;
        }
        console.info(
          `[Simulation] Trainee audio analysis saved item_id=${itemId} turn_index=${turn.turnIndex} markers=${patchAck.markers.join(",") || "none"} confidence=${deliveryAnalysis.confidence.toFixed(2)}`
        );
      } catch (error) {
        console.error("[Simulation] Trainee audio analysis error", error);
      } finally {
        inFlightTraineeAudioAnalysisRef.current.delete(itemId);
      }
    })());
  }

  function queueTraineeAudioAnalysis(
    itemId: string,
    pendingTurn: PendingTraineeAudioAnalysisTurn
  ) {
    pendingTraineeAudioAnalysisTurnsRef.current.set(itemId, pendingTurn);
    maybeStartTraineeAudioAnalysis(itemId);
  }

  function handleTraineeAudioSegment(segment: TraineeAudioSegment) {
    pendingTraineeAudioSegmentsRef.current.set(segment.itemId, segment);
    maybeStartTraineeAudioAnalysis(segment.itemId);
  }

  async function fetchSessionRecord(
    id: string,
    signal?: AbortSignal
  ): Promise<SimulationSession | null> {
    const res = await fetch(`/api/sessions/${id}`, { signal }).catch(() => null);
    if (!res || !res.ok) return null;
    return readJsonSafely(res, parseSimulationSession, null, "session");
  }

  async function fetchSessionTurns(
    id: string,
    signal?: AbortSignal
  ): Promise<TranscriptTurn[]> {
    const res = await fetch(`/api/sessions/${id}/transcript`, { signal }).catch(() => null);
    if (!res || !res.ok) return [];
    return readJsonSafely(res, parseTranscriptTurns, [], "transcript");
  }

  async function fetchSessionEvents(
    id: string,
    signal?: AbortSignal
  ): Promise<SimulationStateEvent[]> {
    const res = await fetch(`/api/sessions/${id}/events`, { signal }).catch(() => null);
    if (!res || !res.ok) return [];
    return readJsonSafely(res, parseSimulationEvents, [], "events");
  }

  async function startSession(signal?: AbortSignal): Promise<boolean> {
    const res = await fetch(`/api/sessions/${sessionId}/start`, {
      method: "POST",
      signal,
    }).catch((error) => {
      console.error("[Simulation Init] Session start request failed", error);
      return null;
    });

    if (!res) return false;
    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(
        `[Simulation Init] Session start returned status=${res.status}`,
        errorText
      );
      return false;
    }

    return true;
  }

  function resolvePendingPatientTurnCompletion() {
    const pending = pendingPatientTurnCompletionRef.current;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingPatientTurnCompletionRef.current = null;
    pending.resolve();
  }

  function beginPendingPatientTurnCompletion() {
    resolvePendingPatientTurnCompletion();

    let resolvePromise = () => {};
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const timeout = setTimeout(() => {
      console.warn(
        `[Bot] Patient turn completion timeout after ${PATIENT_TURN_COMPLETION_TIMEOUT_MS}ms ` +
          `(pending_reply_update=${pendingPatientReplyUpdateRef.current ? "yes" : "no"})`
      );
      resolvePendingPatientTurnCompletion();
    }, PATIENT_TURN_COMPLETION_TIMEOUT_MS);

    pendingPatientTurnCompletionRef.current = {
      promise,
      resolve: resolvePromise,
      timeout,
    };
  }

  function interruptPatientResponsePlayback() {
    cancelCurrentResponse();
    sendEvent({ type: "output_audio_buffer.clear" });
  }

  async function waitForPatientPlaybackToStop(
    abort: AbortController,
    timeoutMs: number = BOT_PATIENT_AUDIO_CLEAR_WAIT_MS
  ) {
    const deadline = Date.now() + timeoutMs;

    while (aiSpeakingRef.current && Date.now() < deadline) {
      if (abort.signal.aborted || !botActiveRef.current) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function quietPatientSessionForBotTurn(abort: AbortController) {
    interruptPatientResponsePlayback();
    await new Promise((resolve) => setTimeout(resolve, BOT_RESPONSE_CANCEL_SETTLE_MS));
    if (abort.signal.aborted || !botActiveRef.current) return;
    await waitForPatientPlaybackToStop(abort);
  }

  async function loadForkHistory(
    session: SimulationSession,
    signal?: AbortSignal
  ): Promise<{ inheritedTurns: TranscriptTurn[]; resumeSnapshot: PersistedTurnSnapshot | null }> {
    if (!session.parent_session_id || session.forked_from_turn_index == null) {
      return { inheritedTurns: [], resumeSnapshot: null };
    }

    const inheritedTurns: TranscriptTurn[] = [];
    let resumeSnapshot: PersistedTurnSnapshot | null = null;
    let sourceSessionId: string | null = session.parent_session_id;
    let sourceTurnIndex: number | null = session.forked_from_turn_index;
    let isImmediateParent = true;

    while (sourceSessionId && sourceTurnIndex != null) {
      const selectedTurnIndex = sourceTurnIndex;
      const [sourceSession, sourceTurns]: [SimulationSession | null, TranscriptTurn[]] = await Promise.all([
        fetchSessionRecord(sourceSessionId, signal),
        fetchSessionTurns(sourceSessionId, signal),
      ]);
      if (!sourceSession) break;

      const selectedTurn = sourceTurns.find((turn) => turn.turn_index === selectedTurnIndex) ?? null;
      const turnsThroughSelection = sourceTurns.filter((turn) => turn.turn_index <= selectedTurnIndex);
      inheritedTurns.unshift(...turnsThroughSelection);

      if (isImmediateParent) {
        resumeSnapshot = getPersistedSnapshotFromTurn(selectedTurn);
        isImmediateParent = false;
      }

      sourceSessionId = sourceSession.parent_session_id;
      sourceTurnIndex = sourceSession.forked_from_turn_index;
    }

    return {
      inheritedTurns,
      resumeSnapshot,
    };
  }

  function getRecentPromptTurns() {
    return transcriptRef.current
      .slice(-20)
      .map((entry) => ({ speaker: entry.speaker, content: entry.content }));
  }

  function buildPatientInstructions(
    snapshot: ValidatedScenarioSnapshot,
    currentState: ReturnType<EscalationEngine["getState"]>,
    recentTurns: { speaker: string; content: string }[],
    voiceProfile: StructuredVoiceProfile | null
  ) {
    const { traits, voiceConfig, escalationRules } = getScenarioConfig(snapshot);
    return buildPrompt({
      title: snapshot.title as string,
      aiRole: snapshot.ai_role as string,
      traineeRole: snapshot.trainee_role as string,
      backstory: snapshot.backstory as string,
      emotionalDriver: snapshot.emotional_driver as string,
      setting: snapshot.setting as string,
      traits,
      voiceConfig,
      escalationRules,
      currentState,
      recentTurns,
      voiceProfile,
    });
  }

  async function fetchPatientVoiceProfile(
    snapshot: ValidatedScenarioSnapshot,
    currentState: ReturnType<EscalationEngine["getState"]>,
    recentTurns: { speaker: string; content: string }[],
    latestClinicianVoiceProfile?: StructuredVoiceProfile | null,
    signal?: AbortSignal
  ): Promise<StructuredVoiceProfile | null> {
    const { traits, voiceConfig } = getScenarioConfig(snapshot);
    const res = await fetch("/api/voice-profile/patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: snapshot.title,
        aiRole: snapshot.ai_role,
        traineeRole: snapshot.trainee_role,
        backstory: snapshot.backstory,
        emotionalDriver: snapshot.emotional_driver,
        setting: snapshot.setting,
        traits,
        voiceConfig,
        currentState,
        recentTurns,
        latestClinicianVoiceProfile,
      }),
      signal,
    }).catch(() => null);

    if (!res || !res.ok) return null;

    return readJsonSafely<StructuredVoiceProfile | null>(
      res,
      (raw) => {
        if (typeof raw !== "object" || raw === null || !("voiceProfile" in raw)) {
          return null;
        }
        return parseStructuredVoiceProfile(raw.voiceProfile);
      },
      null,
      "patient voice profile"
    );
  }

  async function resolvePatientInstructions(
    snapshot: ValidatedScenarioSnapshot,
    currentState: ReturnType<EscalationEngine["getState"]>,
    recentTurns: { speaker: string; content: string }[],
    latestClinicianVoiceProfile?: StructuredVoiceProfile | null,
    signal?: AbortSignal
  ): Promise<string | null> {
    const requestId = patientVoiceRequestRef.current + 1;
    patientVoiceRequestRef.current = requestId;

    const voiceProfile = await fetchPatientVoiceProfile(
      snapshot,
      currentState,
      recentTurns,
      latestClinicianVoiceProfile,
      signal
    );
    if (signal?.aborted || requestId !== patientVoiceRequestRef.current) return null;

    if (voiceProfile) {
      patientVoiceProfileRef.current = voiceProfile;
    }

    // When the fetch fails, pass null rather than the stale ref — the
    // state-driven voice construction in buildVoiceLayer always matches
    // the current escalation level, avoiding tone/state mismatches.
    return buildPatientInstructions(
      snapshot,
      currentState,
      recentTurns,
      voiceProfile
    );
  }

  async function requestBotTurn(
    requestId: number,
    options: BotTurnRequestOptions = {}
  ): Promise<PreparedBotTurn | null> {
    const startedAt = performance.now();
    const snapshot = options.snapshot ?? scenarioRef.current;
    const state = options.state ?? engineRef.current?.getState();
    if (!snapshot || !state || !botActiveRef.current) return null;

    const recentTurns = options.recentTurns ?? transcriptRef.current.slice(-8).map((entry) => ({
      speaker: entry.speaker,
      content: entry.content,
    }));
    const patientVoiceProfile = options.patientVoiceProfile ?? patientVoiceProfileRef.current;

    const res = await fetch("/api/deescalate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recentTurns,
        scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}. Emotional driver: ${snapshot.emotional_driver}`,
        emotionalDriver: snapshot.emotional_driver,
        patientRole: snapshot.ai_role,
        clinicianRole: "experienced British NHS clinician",
        escalationState: state,
        patientVoiceProfile,
      }),
      signal: options.signal,
    }).catch(() => null);

    if (
      !res ||
      options.signal?.aborted ||
      !botActiveRef.current ||
      requestId !== pendingBotTurnRequestRef.current
    ) {
      return null;
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error(
        `[Bot] Failed to generate clinician turn request_id=${requestId} status=${res.status}`,
        errorText
      );
      return FALLBACK_BOT_TURN;
    }

    const payload = await res.json().catch(() => null) as Partial<PreparedBotTurn> | null;
    if (!payload || typeof payload.text !== "string" || payload.text.trim().length === 0) {
      console.error(`[Bot] Invalid clinician turn payload request_id=${requestId}`, payload);
      return FALLBACK_BOT_TURN;
    }

    const preparedTurn: PreparedBotTurn = {
      text: payload.text,
      technique: typeof payload.technique === "string" && payload.technique.trim().length > 0
        ? payload.technique
        : "general de-escalation",
      voiceProfile: payload.voiceProfile ?? null,
    };
    console.info(
      `[Bot] Clinician turn ready request_id=${requestId} reason=${options.reason || "unspecified"} seed=${options.seed ?? "none"} elapsed_ms=${Math.round(performance.now() - startedAt)}`
    );
    return preparedTurn;
  }

  function prefetchNextBotTurn(options: BotTurnRequestOptions = {}) {
    const requestId = pendingBotTurnRequestRef.current + 1;
    pendingBotTurnRequestRef.current = requestId;
    pendingBotTurnSeedRef.current = options.seed ?? null;
    console.info(
      `[Bot] Prefetching clinician turn request_id=${requestId} reason=${options.reason || "unspecified"} seed=${options.seed ?? "none"}`
    );
    pendingBotTurnRef.current = requestBotTurn(requestId, options);
  }

  async function consumeBotTurn(signal?: AbortSignal): Promise<PreparedBotTurn | null> {
    const prefetched = pendingBotTurnRef.current;
    pendingBotTurnRef.current = null;
    pendingBotTurnSeedRef.current = null;

    if (prefetched) {
      const resolved = await prefetched;
      if (resolved || signal?.aborted || !botActiveRef.current) {
        return resolved;
      }
    }

    const requestId = pendingBotTurnRequestRef.current + 1;
    pendingBotTurnRequestRef.current = requestId;
    console.info(`[Bot] Generating clinician turn on demand request_id=${requestId}`);
    return requestBotTurn(requestId, { signal, reason: "on_demand" });
  }

  async function refinePatientStateFromBotReply(
    requestId: number,
    turnIndex: number,
    snapshot: ValidatedScenarioSnapshot,
    stateAfter: EscalationState,
    recentTurnsForPrompt: { speaker: string; content: string }[],
    classifierResult: ClassifierResult,
    triggerType: TurnTriggerType
  ): Promise<void> {
    const startedAt = performance.now();
    const isStale = () =>
      requestId !== patientReplyUpdateRequestRef.current || !botActiveRef.current || endingRef.current;

    const nextVoiceProfile = await fetchPatientVoiceProfile(
      snapshot,
      stateAfter,
      recentTurnsForPrompt,
      null,
      botAbortRef.current?.signal
    );
    if (isStale()) return;

    const effectiveVoiceProfile = nextVoiceProfile ?? patientVoiceProfileRef.current;
    if (!nextVoiceProfile || !effectiveVoiceProfile) return;

    patientVoiceProfileRef.current = nextVoiceProfile;

    console.info(
      `[Bot Patient State] voice_profile_ready request_id=${requestId} elapsed_ms=${Math.round(performance.now() - startedAt)}`
    );

    const refinedInstructions = buildPatientInstructions(
      snapshot,
      stateAfter,
      recentTurnsForPrompt,
      effectiveVoiceProfile
    );
    patientPromptRef.current = refinedInstructions;
    updateSession(refinedInstructions);

    if (pendingBotTurnRef.current && pendingBotTurnSeedRef.current === requestId) {
      prefetchNextBotTurn({
        signal: botAbortRef.current?.signal,
        snapshot,
        state: stateAfter,
        recentTurns: recentTurnsForPrompt,
        patientVoiceProfile: effectiveVoiceProfile,
        seed: requestId,
        reason: "refined_after_patient",
      });
    }

    const refinedSnapshot = buildSnapshot({
      classifierResult,
      triggerType,
      stateAfter,
      patientVoiceProfileAfter: effectiveVoiceProfile,
      patientPromptAfter: refinedInstructions,
    });
    if (!refinedSnapshot) return;

    updatePersistedTurnSnapshot(turnIndex, refinedSnapshot);
  }

  async function syncPatientStateFromBotReply(
    text: string,
    requestId: number,
    turnIndex: number,
    recentTurnsOverride?: { speaker: string; content: string }[]
  ): Promise<PatientReplyUpdateResult | null> {
    if (!engineRef.current || !scenarioRef.current || !botActiveRef.current) return null;
    const startedAt = performance.now();
    const snapshot = scenarioRef.current;
    const isStale = () =>
      requestId !== patientReplyUpdateRequestRef.current || !botActiveRef.current || endingRef.current;
    const recentTurns = recentTurnsOverride
      ?? transcriptRef.current.slice(-4).map((entry) => ({ speaker: entry.speaker, content: entry.content }));

    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterance: text,
          mode: "patient_response",
          context: {
            recentTurns,
            scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}`,
            currentEscalation: engineRef.current.getLevel(),
            speakerVoiceProfile: lastClinicianVoiceProfileRef.current,
          },
        }),
      }).catch(() => null);

      if (!res || !res.ok || isStale() || !engineRef.current) return null;

      const classResult = await readJsonSafely(res, parseClassifierResult, null, "classification");
      if (!classResult || isStale() || !engineRef.current) return null;
      if (isStale() || !engineRef.current) return null;

      console.log("[Bot Patient State] Classifier:", classResult);

      const prevState = engineRef.current.getState();
      const delta = engineRef.current.processClassification(classResult, "patient_response");
      const newState = engineRef.current.getState();
      if (isStale()) return null;

      console.log("[Bot Patient State]", prevState.level, "→", newState.level, delta.trigger_type);
      console.info(`[Bot Patient State] classified elapsed_ms=${Math.round(performance.now() - startedAt)}`);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      if (engineRef.current.shouldAutoEnd()) {
        handleEndSession("auto_ceiling");
        return {
          snapshot: buildSnapshot({
            classifierResult: classResult,
            triggerType: delta.trigger_type,
            stateAfter: newState,
          }),
          stateAfter: newState,
          triggerType: delta.trigger_type,
          classifierResult: classResult,
          recentTurnsForPrompt: getRecentPromptTurns(),
        };
      }

      const evtIdx = eventIndexRef.current++;
      persistSessionEvent({
        event_index: evtIdx,
        event_type: delta.trigger_type === "escalation"
          ? "escalation_change"
          : delta.trigger_type === "de_escalation"
            ? "de_escalation_change"
            : "classification_result",
        escalation_before: prevState.level,
        escalation_after: newState.level,
        trust_before: prevState.trust,
        trust_after: newState.trust,
        listening_before: prevState.willingness_to_listen,
        listening_after: newState.willingness_to_listen,
        payload: {
          classifier: classResult,
          delta,
          source: "bot_patient_response",
        },
      });

      const recentTurnsForPrompt = getRecentPromptTurns();

      // When escalation level changed, the stored voice profile is stale — its
      // tone/pacing/delivery descriptions still reflect the *previous* level.
      // Passing null forces buildVoiceLayer to fall back to the state-driven
      // voice construction, which correctly scales with the new level.  The
      // refined voice profile (fetched async below) will replace it shortly.
      const levelChanged = newState.level !== prevState.level;
      const voiceForImmediate = levelChanged ? null : patientVoiceProfileRef.current;

      prefetchNextBotTurn({
        signal: botAbortRef.current?.signal,
        snapshot,
        state: newState,
        recentTurns: recentTurnsForPrompt,
        patientVoiceProfile: voiceForImmediate,
        seed: requestId,
        reason: "fast_after_patient",
      });

      const immediateInstructions = buildPatientInstructions(
        snapshot,
        newState,
        recentTurnsForPrompt,
        voiceForImmediate
      );
      patientPromptRef.current = immediateInstructions;
      updateSession(immediateInstructions);

      const immediateSnapshot = buildSnapshot({
        classifierResult: classResult,
        triggerType: delta.trigger_type,
        stateAfter: newState,
        patientVoiceProfileAfter: patientVoiceProfileRef.current,
        patientPromptAfter: immediateInstructions,
      });
      console.info(
        `[Bot Patient State] critical_update_ready request_id=${requestId} elapsed_ms=${Math.round(performance.now() - startedAt)}`
      );

      void refinePatientStateFromBotReply(
        requestId,
        turnIndex,
        snapshot,
        newState,
        recentTurnsForPrompt,
        classResult,
        delta.trigger_type
      );

      return {
        snapshot: immediateSnapshot,
        stateAfter: newState,
        triggerType: delta.trigger_type,
        classifierResult: classResult,
        recentTurnsForPrompt,
      };
    } catch (err) {
      if (isStale()) return null;
      console.error("[Bot Patient State] Classification error:", err);
      return null;
    }
  }

  function queuePatientReplyStateUpdate(
    text: string,
    turnIndex: number,
    recentTurnsOverride?: { speaker: string; content: string }[]
  ) {
    const requestId = patientReplyUpdateRequestRef.current + 1;
    patientReplyUpdateRequestRef.current = requestId;

    const pending = syncPatientStateFromBotReply(text, requestId, turnIndex, recentTurnsOverride);
    pendingPatientReplyUpdateRef.current = pending;

    void pending.finally(() => {
      if (pendingPatientReplyUpdateRef.current === pending) {
        pendingPatientReplyUpdateRef.current = null;
      }
    });

    return pending;
  }

  const handleAiDelta = useCallback((delta: string) => {
    aiSpeakingRef.current = true;
    setCurrentAiText((prev) => prev + delta);
    setIsSpeaking(true);
  }, []);

  async function handleAiTranscriptDone(text: string) {
    const timestamp = new Date().toISOString();
    const recentTurnsBeforeAiTurn = transcriptRef.current
      .slice(-4)
      .map((entry) => ({ speaker: entry.speaker, content: entry.content }));
    const entry = { speaker: "ai", content: text, timestamp } as const;
    appendTranscriptEntry(entry);
    const idx = turnIndexRef.current++;
    // When bot is not active, wait for any in-flight trainee classification so the
    // engine state is up-to-date before we snapshot. Without this, the patient turn
    // can be persisted with a stale level (the classify API call for the preceding
    // trainee utterance may still be in flight).
    if (!botActiveRef.current && classifyingRef.current) {
      await classifyDoneRef.current;
    }
    const turnResult = botActiveRef.current
      ? await queuePatientReplyStateUpdate(text, idx, recentTurnsBeforeAiTurn)
      : null;
    const turnSnapshot = turnResult?.snapshot ?? buildSnapshot();
    if (turnSnapshot) {
      persistTranscriptTurn(idx, "ai", text, turnSnapshot, timestamp);
    }
    if (pendingUpdateRef.current) {
      patientPromptRef.current = pendingUpdateRef.current;
      updateSession(pendingUpdateRef.current);
      pendingUpdateRef.current = null;
    }
    if (botActiveRef.current) {
      resolvePendingPatientTurnCompletion();
    }
  }

  function handleAiPlaybackComplete() {
    aiSpeakingRef.current = false;
    setCurrentAiText("");
    setIsSpeaking(false);
  }

  // Safety-timeout variant: update UI + ungate mic for the human trainee,
  // but leave aiSpeakingRef true so the bot-clinician flow doesn't
  // interrupt patient audio that may still be playing from the WebRTC buffer.
  function handleAiPlaybackSafetyTimeout() {
    setCurrentAiText("");
    setIsSpeaking(false);
    // aiSpeakingRef.current intentionally NOT set to false
  }

  const handleTraineeTranscript = useCallback(async (text: string, meta?: TraineeTranscriptMeta) => {
    const timestamp = new Date().toISOString();
    const recentTurns = transcriptRef.current.slice(-4).map((e) => ({ speaker: e.speaker, content: e.content }));
    appendTranscriptEntry({ speaker: "trainee", content: text, timestamp });
    const idx = turnIndexRef.current++;
    const itemId = meta?.itemId ?? null;

    if (classifyingRef.current || !engineRef.current || !scenarioRef.current) {
      const fallbackSnapshot = buildSnapshot();
      if (fallbackSnapshot) {
        persistTranscriptTurn(idx, "trainee", text, fallbackSnapshot, timestamp, meta?.durationMs ?? null);
      }
      return;
    }
    classifyingRef.current = true;
    let resolveClassifyDone!: () => void;
    classifyDoneRef.current = new Promise<void>((r) => { resolveClassifyDone = r; });
    const snapshot = scenarioRef.current;
    const scenarioContext = `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}`;
    const currentEscalation = engineRef.current.getLevel();

    let classResult: ClassifierResult | null = null;
    let delta: { trigger_type: string; level_delta: number; trust_delta: number; listening_delta: number; reason: string } | null = null;
    let newState: EscalationState | null = null;
    let prevState: EscalationState | null = null;

    try {
      // Fetch trainee voice profile first so the classifier can assess tone
      const traineeVoiceProfile = await fetch("/api/voice-profile/trainee", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text, scenarioContext, currentEscalation, recentTurns }),
      }).then(async (res) => {
        if (!res.ok) return null;
        return readJsonSafely<StructuredVoiceProfile | null>(
          res,
          (raw) => {
            if (typeof raw !== "object" || raw === null || !("voiceProfile" in raw)) return null;
            return parseStructuredVoiceProfile((raw as Record<string, unknown>).voiceProfile);
          },
          null,
          "trainee voice profile"
        );
      }).catch(() => null);

      const classifyRes = await fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text, context: { recentTurns, scenarioContext, currentEscalation, speakerVoiceProfile: traineeVoiceProfile, milestones: snapshot.scenario_milestones.filter((m) => m.id && !completedMilestonesRef.current.has(m.id)).map((m) => ({ id: m.id!, description: m.description, classifier_hint: m.classifier_hint })) } }),
      });
      if (!classifyRes.ok) {
        console.error("[Escalation] Classify API failed:", classifyRes.status);
        const fallbackSnapshot = buildSnapshot();
        if (fallbackSnapshot) {
          persistTranscriptTurn(idx, "trainee", text, fallbackSnapshot, timestamp, meta?.durationMs ?? null);
        }
        return;
      }
      classResult = await readJsonSafely(classifyRes, parseClassifierResult, null, "classification");
      if (!classResult) {
        const fallbackSnapshot = buildSnapshot();
        if (fallbackSnapshot) {
          persistTranscriptTurn(idx, "trainee", text, fallbackSnapshot, timestamp, meta?.durationMs ?? null);
        }
        return;
      }
      if (classResult!.clinical_milestone_completed) {
        completedMilestonesRef.current.add(classResult!.clinical_milestone_completed);
      }
      console.log("[Escalation] Classifier:", classResult);

      prevState = engineRef.current.getState();
      delta = engineRef.current.processClassification(classResult!, "trainee");
      newState = engineRef.current.getState();
      console.log("[Escalation]", prevState.level, "→", newState.level, delta.trigger_type);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      const evtIdx = eventIndexRef.current++;
      persistSessionEvent({
        event_index: evtIdx,
        event_type: delta.trigger_type === "escalation" ? "escalation_change" : delta.trigger_type === "de_escalation" ? "de_escalation_change" : "classification_result",
        escalation_before: prevState.level,
        escalation_after: newState.level,
        trust_before: prevState.trust,
        trust_after: newState.trust,
        listening_before: prevState.willingness_to_listen,
        listening_after: newState.willingness_to_listen,
        payload: { classifier: classResult, delta },
      });

      if (engineRef.current.shouldAutoEnd()) handleEndSession("auto_ceiling");
    } catch (err) {
      console.error("Classification error:", err);
      const fallbackSnapshot = buildSnapshot();
      if (fallbackSnapshot) {
        persistTranscriptTurn(idx, "trainee", text, fallbackSnapshot, timestamp, meta?.durationMs ?? null);
      }
      return;
    } finally { classifyingRef.current = false; resolveClassifyDone(); }

    // Resolve patient instructions outside the classifying lock so subsequent
    // trainee utterances can be classified without waiting for voice profile fetch
    try {
      const newInstructions = await resolvePatientInstructions(
        snapshot,
        newState!,
        getRecentPromptTurns()
      );
      if (!newInstructions) return;
      patientPromptRef.current = newInstructions;

      const turnSnapshot = buildSnapshot({
        classifierResult: classResult!,
        triggerType: delta!.trigger_type as "escalation" | "de_escalation" | "neutral",
        stateAfter: newState!,
        patientPromptAfter: newInstructions,
      });
      if (turnSnapshot) {
        const persistPromise = persistTranscriptTurn(
          idx,
          "trainee",
          text,
          turnSnapshot,
          timestamp,
          meta?.durationMs ?? null
        );
        if (itemId && classResult) {
          queueTraineeAudioAnalysis(itemId, {
            turnIndex: idx,
            utterance: text,
            scenarioContext,
            currentEscalation,
            recentTurns,
            classifierResult: classResult,
            snapshot: turnSnapshot,
            durationMs: meta?.durationMs ?? null,
            turnPersistPromise: persistPromise ?? null,
          });
        }
      }

      if (aiSpeakingRef.current) {
        pendingUpdateRef.current = newInstructions;
      } else {
        updateSession(newInstructions);
      }
    } catch (err) {
      console.error("Patient instruction resolution error:", err);
      // Still persist the turn with what we have
      const fallbackSnapshot = buildSnapshot({
        classifierResult: classResult!,
        triggerType: delta!.trigger_type as "escalation" | "de_escalation" | "neutral",
        stateAfter: newState!,
      });
      if (fallbackSnapshot) {
        const persistPromise = persistTranscriptTurn(
          idx,
          "trainee",
          text,
          fallbackSnapshot,
          timestamp,
          meta?.durationMs ?? null
        );
        if (itemId && classResult) {
          queueTraineeAudioAnalysis(itemId, {
            turnIndex: idx,
            utterance: text,
            scenarioContext,
            currentEscalation,
            recentTurns,
            classifierResult: classResult,
            snapshot: fallbackSnapshot,
            durationMs: meta?.durationMs ?? null,
            turnPersistPromise: persistPromise ?? null,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, updateSession]);

  async function handleEndSession(exitType: string = "normal") {
    if (endingRef.current) return; endingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    stopBot();
    cancelCurrentResponse();
    await new Promise((r) => setTimeout(r, 50));

    // Stop the recorder BEFORE disconnect — disconnect tears down the
    // MediaStream tracks which would leave the MediaRecorder with no input.
    const recordingBlob = await stopRecording().catch((err) => {
      console.error("[SessionRecorder] Failed to stop recording", err);
      return null;
    });

    disconnect();

    // Upload the recording in parallel with end-session persistence
    const audioUploadPromise = recordingBlob
      ? fetch(`/api/sessions/${sessionId}/audio`, {
          method: "POST",
          body: (() => {
            const fd = new FormData();
            fd.append(
              "file",
              recordingBlob,
              `recording.${recordingBlob.type.includes("mp4") ? "mp4" : "webm"}`
            );
            const recStartedAt = getRecordingStartedAt();
            if (recStartedAt) {
              fd.append("recording_started_at", recStartedAt);
            }
            return fd;
          })(),
        }).catch((err) => {
          console.error("[SessionRecorder] Audio upload failed", err);
        })
      : Promise.resolve();

    await trackPersistence(
      persistRequest(
        `session end ${exitType}`,
        `/api/sessions/${sessionId}/end`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            exit_type: exitType,
            final_escalation_level: engineRef.current?.getLevel(),
            peak_escalation_level: peakLevelRef.current,
          }),
        }
      )
    );
    await flushPendingPersistence(8000);
    await audioUploadPromise;
    router.push(`/review/${sessionId}`);
  }

  // --- AI Clinician Bot ---

  async function classifyBotUtterance(
    text: string,
    clinicianVoiceProfile: StructuredVoiceProfile | null,
    signal: AbortSignal,
    recentTurnsOverride?: { speaker: string; content: string }[]
  ): Promise<PersistedTurnSnapshot | null> {
    if (!engineRef.current || !scenarioRef.current) return null;
    const snapshot = scenarioRef.current;
    const recentTurns = recentTurnsOverride
      ?? transcriptRef.current.slice(-4).map((e) => ({ speaker: e.speaker, content: e.content }));
    const isStale = () => signal.aborted || !botActiveRef.current || endingRef.current;

    try {
      if (isStale()) return null;
      console.info("[Bot Prep] Starting patient-state preparation from clinician text and voice profile");

      // Pipeline: classify and fetch voice profile in parallel.
      // Voice profile uses pre-classification state as a close approximation
      // (clinician impact is dampened, so the state delta is small).
      const currentState = engineRef.current.getState();
      const recentPromptTurns = getRecentPromptTurns();

      const classifyPromise = fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterance: text,
          mode: "clinician_utterance",
          context: {
            recentTurns,
            scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}`,
            currentEscalation: engineRef.current.getLevel(),
            speakerVoiceProfile: clinicianVoiceProfile,
          },
        }),
        signal,
      });

      const voiceProfilePromise = fetchPatientVoiceProfile(
        snapshot,
        currentState,
        recentPromptTurns,
        clinicianVoiceProfile,
        signal
      );

      const res = await classifyPromise;
      if (!res.ok || isStale() || !engineRef.current) return null;
      const classResult = await res.json();
      if (isStale() || !engineRef.current) return null;
      console.log("[Bot Escalation] Classifier:", classResult);

      const prevState = engineRef.current.getState();
      const delta = engineRef.current.processClassification(classResult, "clinician");
      const newState = engineRef.current.getState();
      if (isStale()) return null;
      console.log("[Bot Escalation]", prevState.level, "→", newState.level, delta.trigger_type);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      const evtIdx = eventIndexRef.current++;
      persistSessionEvent({
        event_index: evtIdx,
        event_type: delta.trigger_type === "escalation" ? "escalation_change" : delta.trigger_type === "de_escalation" ? "de_escalation_change" : "classification_result",
        escalation_before: prevState.level,
        escalation_after: newState.level,
        trust_before: prevState.trust,
        trust_after: newState.trust,
        listening_before: prevState.willingness_to_listen,
        listening_after: newState.willingness_to_listen,
        payload: { classifier: classResult, delta, source: "bot_clinician" },
      });

      // Voice profile fetch was running in parallel — await it now
      const voiceProfile = await voiceProfilePromise;
      if (isStale()) return null;

      // The voice profile was fetched with the pre-classification state.
      // If the level changed, that profile's tone/delivery is stale — fall
      // back to state-driven voice construction which always matches the
      // current level.
      const levelChanged = newState.level !== prevState.level;
      const effectiveProfile = levelChanged ? null : (voiceProfile ?? patientVoiceProfileRef.current);

      if (voiceProfile && !levelChanged) {
        patientVoiceProfileRef.current = voiceProfile;
      }

      const newInstructions = buildPatientInstructions(
        snapshot,
        newState,
        recentPromptTurns,
        effectiveProfile
      );
      if (newInstructions && !isStale()) {
        console.info("[Bot Prep] Patient response profile prepared from clinician text and voice profile");
        patientPromptRef.current = newInstructions;
        updateSession(newInstructions);
        return buildSnapshot({
          classifierResult: classResult,
          triggerType: delta.trigger_type,
          stateAfter: newState,
          patientPromptAfter: newInstructions,
        });
      }
      return buildSnapshot({
        classifierResult: classResult,
        triggerType: delta.trigger_type,
        stateAfter: newState,
      });
    } catch (err) {
      if (isStale()) return null;
      console.error("[Bot] Classification error:", err);
      return null;
    }
  }

  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  function getClinicianVoiceContext(technique: string): ClinicianVoiceContext {
    const snapshot = scenarioRef.current;
    const state = engineRef.current?.getState();

    return {
      clinicianRole: "experienced British NHS clinician",
      patientRole: snapshot?.ai_role || "patient",
      emotionalDriver: snapshot?.emotional_driver || "",
      deescalationTechnique: technique,
      escalationState: state ? {
        level: state.level,
        trust: state.trust,
        willingness_to_listen: state.willingness_to_listen,
        anger: state.anger,
        frustration: state.frustration,
      } : undefined,
    };
  }

  function getClinicianRealtimeInstructions(
    technique: string,
    voiceProfile: StructuredVoiceProfile | null
  ): string {
    const context = getClinicianVoiceContext(technique);
    return voiceProfile
      ? buildClinicianRealtimeInstructionsFromProfile(voiceProfile, context)
      : buildClinicianRealtimeInstructions(context);
  }

  async function ensureClinicianRendererConnected(instructions: string): Promise<boolean> {
    if (clinicianRendererReadyRef.current) {
      return true;
    }

    if (clinicianRendererConnectRef.current) {
      return clinicianRendererConnectRef.current;
    }

    clinicianRendererErrorRef.current = null;
    console.info(`[Clinician Audio] path=realtime status=connecting voice=${CLINICIAN_REALTIME_VOICE}`);

    const pending = connectClinicianRenderer({
      voice: CLINICIAN_REALTIME_VOICE,
      instructions,
      onError: (error) => {
        clinicianRendererReadyRef.current = false;
        clinicianRendererErrorRef.current = error;
        console.error(`[Clinician Audio] path=realtime status=error voice=${CLINICIAN_REALTIME_VOICE}`, error);
      },
    }).then((connected) => {
      clinicianRendererReadyRef.current = connected;
      if (connected) {
        console.info(`[Clinician Audio] path=realtime status=ready voice=${CLINICIAN_REALTIME_VOICE}`);
      } else {
        console.warn(
          `[Clinician Audio] fallback=tts reason="${clinicianRendererErrorRef.current || "renderer connect failed"}" voice=${CLINICIAN_REALTIME_VOICE}`
        );
      }
      return connected;
    }).finally(() => {
      clinicianRendererConnectRef.current = null;
    });

    clinicianRendererConnectRef.current = pending;
    return pending;
  }

  async function speakWithTtsFallback(
    text: string,
    technique: string,
    voiceProfile: StructuredVoiceProfile | null,
    abort: AbortController
  ): Promise<boolean> {
    const context = getClinicianVoiceContext(technique);
    console.info('[Clinician Audio] path=tts status=requested');
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, style: "clinician", context, voiceProfile }),
      signal: abort.signal,
    }).catch(() => null);

    if (!res || abort.signal.aborted) return false;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[Clinician Audio] path=tts status=failed", res.status, errText);
      return false;
    }

    console.info("[Clinician Audio] path=tts status=playing");
    const blob = await res.blob();
    if (abort.signal.aborted) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    botAudioRef.current = audio;

    return new Promise<boolean>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); botAudioRef.current = null; resolve(true); };
      audio.onerror = () => { URL.revokeObjectURL(url); botAudioRef.current = null; resolve(false); };
      if (abort.signal.aborted) { URL.revokeObjectURL(url); resolve(false); return; }
      audio.play().catch(() => { URL.revokeObjectURL(url); resolve(false); });
    });
  }

  async function speakWithClinicianAudio(
    text: string,
    technique: string,
    voiceProfile: StructuredVoiceProfile | null,
    abort: AbortController
  ): Promise<ClinicianAudioResult> {
    const startedAt = performance.now();
    const finish = (
      partial: Omit<ClinicianAudioResult, "elapsedMs">
    ): ClinicianAudioResult => ({
      ...partial,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    const realtimeInstructions = getClinicianRealtimeInstructions(technique, voiceProfile);
    const connected = await ensureClinicianRendererConnected(realtimeInstructions);
    if (abort.signal.aborted || !botActiveRef.current) {
      return finish({ path: "none", realtimeOutcome: null, fallbackReason: null, rendererError: null });
    }

    if (connected) {
      console.info(`[Clinician Audio] path=realtime status=speaking voice=${CLINICIAN_REALTIME_VOICE}`);
      const rendered = await speakWithClinicianRenderer({
        text,
        instructions: realtimeInstructions,
      });

      if (abort.signal.aborted || !botActiveRef.current) {
        return finish({ path: "none", realtimeOutcome: null, fallbackReason: null, rendererError: null });
      }

      if (rendered === "completed") {
        console.info(`[Clinician Audio] path=realtime status=done voice=${CLINICIAN_REALTIME_VOICE}`);
        return finish({ path: "realtime", realtimeOutcome: "completed", fallbackReason: null, rendererError: null });
      }

      if (rendered === "partial") {
        console.warn(
          `[Clinician Audio] skip_tts_fallback reason="renderer failed after playback started" tail_guard_ms=${CLINICIAN_REALTIME_PARTIAL_TAIL_GUARD_MS}`
        );
        await new Promise((resolve) => setTimeout(resolve, CLINICIAN_REALTIME_PARTIAL_TAIL_GUARD_MS));
        if (abort.signal.aborted || !botActiveRef.current) {
          return finish({ path: "none", realtimeOutcome: "partial", fallbackReason: null, rendererError: clinicianRendererErrorRef.current });
        }
        return finish({
          path: "realtime",
          realtimeOutcome: "partial",
          fallbackReason: "renderer failed after playback started",
          rendererError: clinicianRendererErrorRef.current,
        });
      }

      clinicianRendererReadyRef.current = false;
      disconnectClinicianRenderer();
      console.warn('[Clinician Audio] fallback=tts reason="renderer speak failed"');
    }

    const fallbackReason = connected
      ? "renderer speak failed"
      : clinicianRendererErrorRef.current || "renderer connect failed";
    const ttsPlayed = await speakWithTtsFallback(text, technique, voiceProfile, abort);
    if (abort.signal.aborted || !botActiveRef.current) {
      return finish({
        path: "none",
        realtimeOutcome: "failed",
        fallbackReason,
        rendererError: clinicianRendererErrorRef.current,
      });
    }
    return finish({
      path: ttsPlayed ? "tts" : "none",
      realtimeOutcome: "failed",
      fallbackReason,
      rendererError: clinicianRendererErrorRef.current,
    });
  }

  async function runBotTurn(abort: AbortController) {
    if (abort.signal.aborted || !botActiveRef.current) return;

    await quietPatientSessionForBotTurn(abort);
    if (abort.signal.aborted || !botActiveRef.current) return;

    setBotSpeaking(true);
    const preparedTurn = await consumeBotTurn(abort.signal);
    if (!preparedTurn || abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    const { text, technique, voiceProfile } = preparedTurn;
    console.log("[Bot] Generated:", text, "| Technique:", technique);
    lastClinicianVoiceProfileRef.current = voiceProfile;
    const recentTurnsBeforeBotTurn = transcriptRef.current
      .slice(-4)
      .map((entry) => ({ speaker: entry.speaker, content: entry.content }));

    // Add to transcript
    const timestamp = new Date().toISOString();
    const entry: TranscriptEntry = { speaker: "system", content: text, timestamp };
    appendTranscriptEntry(entry);
    const idx = turnIndexRef.current++;

    // Run speech and classification in parallel — classification completes during speech
    const classifyPromise = classifyBotUtterance(
      text,
      voiceProfile,
      abort.signal,
      recentTurnsBeforeBotTurn
    );

    const clinicianAudioResult = await speakWithClinicianAudio(text, technique, voiceProfile, abort);
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    const clinicianAudioEventIdx = eventIndexRef.current++;
    persistSessionEvent({
      event_index: clinicianAudioEventIdx,
      event_type: "clinician_audio",
      payload: {
        source: "bot_clinician",
        turn_index: idx,
        technique,
        path: clinicianAudioResult.path,
        realtime_outcome: clinicianAudioResult.realtimeOutcome,
        fallback_reason: clinicianAudioResult.fallbackReason,
        renderer_error: clinicianAudioResult.rendererError,
        elapsed_ms: clinicianAudioResult.elapsedMs,
      },
    });

    if (clinicianAudioResult.path === "realtime") {
      console.info(`[Clinician Audio] path=realtime status=handoff_wait delay_ms=${CLINICIAN_REALTIME_HANDOFF_DELAY_MS}`);
      await new Promise((resolve) => setTimeout(resolve, CLINICIAN_REALTIME_HANDOFF_DELAY_MS));
      if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }
    }

    // Classification should already be done by now (ran during speech).
    // If not, wait for it — but this is much shorter than the full sequential delay.
    const botTurnSnapshot = await classifyPromise;
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    const persistedSnapshot = botTurnSnapshot ?? buildSnapshot();
    if (persistedSnapshot) {
      persistTranscriptTurn(idx, "system", text, persistedSnapshot, timestamp);
    }

    setBotSpeaking(false);

    // Cancel any in-flight patient response before injecting the bot's reply
    interruptPatientResponsePlayback();
    await new Promise((resolve) => setTimeout(resolve, BOT_RESPONSE_CANCEL_SETTLE_MS));
    if (abort.signal.aborted || !botActiveRef.current) return;

    // Inject the bot's text into the Realtime session so the patient hears and responds
    beginPendingPatientTurnCompletion();
    sendEvent({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    sendEvent({ type: "response.create" });

    // Wait for the patient to finish responding, then loop
    await waitForPatientResponse(abort);
    if (abort.signal.aborted || !botActiveRef.current) return;

    // Next bot turn
    runBotTurn(abort);
  }

  function waitForPatientResponse(abort: AbortController): Promise<void> {
    return new Promise((resolve) => {
      let sawPatientSpeaking = false;
      let speakingStartedAt = 0;
      const check = setInterval(() => {
        if (abort.signal.aborted || !botActiveRef.current) {
          clearInterval(check);
          resolve();
          return;
        }

        if (aiSpeakingRef.current) {
          if (!sawPatientSpeaking) speakingStartedAt = Date.now();
          sawPatientSpeaking = true;
          // Safety: if the buffer-stopped event never arrives, don't poll
          // forever — force-clear after a generous timeout.
          if (Date.now() - speakingStartedAt > 15_000) {
            console.warn("[Bot] Patient speaking safety timeout (15s) — force-clearing aiSpeakingRef");
            aiSpeakingRef.current = false;
          }
          return;
        }

        if (sawPatientSpeaking) {
          clearInterval(check);
          void (async () => {
            const pendingTurnCompletion = pendingPatientTurnCompletionRef.current?.promise;
            if (pendingTurnCompletion) {
              await pendingTurnCompletion;
            }
            // Don't await pendingPatientReplyUpdate — the voice profile update
            // can finish in the background while the next bot turn starts.
            // The escalation state is already updated synchronously from the
            // classifier result, which is all the next bot turn needs.
            if (abort.signal.aborted || !botActiveRef.current) {
              resolve();
              return;
            }
            setTimeout(resolve, BOT_TURN_POST_PATIENT_DELAY_MS);
          })();
          return;
        }
      }, 25);
    });
  }

  function startBot() {
    botActiveRef.current = true;
    setBotActive(true);
    setMicForcedOff(true);
    setTurnDetection(false);
    interruptPatientResponsePlayback();

    const abort = new AbortController();
    botAbortRef.current = abort;

    const warmupInstructions = getClinicianRealtimeInstructions(
      "general de-escalation",
      null
    );
    void ensureClinicianRendererConnected(warmupInstructions);
    prefetchNextBotTurn({ signal: abort.signal });

    // Wait a beat then start the first bot turn
    setTimeout(() => runBotTurn(abort), 500);
  }

  function stopBot() {
    patientReplyUpdateRequestRef.current += 1;
    patientVoiceRequestRef.current += 1;
    pendingPatientReplyUpdateRef.current = null;
    resolvePendingPatientTurnCompletion();
    pendingBotTurnRequestRef.current += 1;
    pendingBotTurnRef.current = null;
    clinicianRendererReadyRef.current = false;
    clinicianRendererConnectRef.current = null;
    botActiveRef.current = false;
    setBotActive(false);
    setBotSpeaking(false);

    // Cancel the patient's in-flight response and clear audio so the echo gate
    // releases immediately instead of staying locked for the patient's full reply.
    cancelCurrentResponse();
    sendEvent({ type: "output_audio_buffer.clear" });

    setTurnDetection(true);
    setMicForcedOff(false);
    disconnectClinicianRenderer();
    // Stop any playing bot audio
    if (botAudioRef.current) {
      botAudioRef.current.pause();
      botAudioRef.current.src = "";
      botAudioRef.current = null;
    }
    if (botAbortRef.current) {
      botAbortRef.current.abort();
      botAbortRef.current = null;
    }
  }

  function handleToggleMic() { toggleMic(); setMicEnabled(micMuted); }
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const ec = escColor(escalationLevel);
  const title = (scenarioRef.current?.title as string) || "Simulation";
  const setting = (scenarioRef.current?.setting as string) || "";
  const aiRole = (scenarioRef.current?.ai_role as string) || "Patient";
  const traineeRole = (scenarioRef.current?.trainee_role as string) || "Clinician";
  const emotionalDriver = (scenarioRef.current?.emotional_driver as string) || "";
  const statusHeading = "Patient/relative status";
  const supportStatusText = botActive
    ? botSpeaking
      ? "AI clinician is speaking on your behalf"
      : isSpeaking
        ? `${aiRole} is responding to the AI clinician`
        : "AI clinician support is active"
    : isSpeaking
      ? `${aiRole} is speaking`
      : connectionStatus === "connected"
        ? "Listening — speak when ready"
        : connectionStatus === "error"
          ? "Connection failed — please refresh to retry"
          : connectionStatus === "reconnecting"
            ? "Reconnecting..."
            : "Connecting...";
  const supportHelperText = botActive
    ? "AI clinician support is active. Resume the conversation whenever you're ready."
    : "The AI clinician will take over temporarily and model a response. You can resume at any time.";

  if (!scenarioLoaded) {
    return (
      <div className="flex h-[calc(100vh-36px)] items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          <p className="mt-4 text-[13px] text-slate-500">Connecting to simulation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-36px)] flex-col bg-white text-slate-900">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 px-4 sm:px-5">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-[14px] font-semibold truncate">{title}</h1>
          <span className="hidden sm:inline text-[12px] tabular-nums text-slate-400">{formatTime(elapsed)}</span>
        </div>
        <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
          connectionStatus === "connected" ? "bg-emerald-50 text-emerald-600"
            : connectionStatus === "error" ? "bg-red-50 text-red-600"
            : connectionStatus === "reconnecting" ? "bg-amber-50 text-amber-600"
            : "bg-slate-50 text-slate-400"
        )}>
          <span className={cn("h-1.5 w-1.5 rounded-full",
            connectionStatus === "connected" ? "bg-emerald-500 animate-pulse"
              : connectionStatus === "error" ? "bg-red-500"
              : connectionStatus === "reconnecting" ? "bg-amber-500 animate-pulse"
              : "bg-slate-300"
          )} />
          {connectionStatus === "connected" ? "Live"
            : connectionStatus === "connecting" ? "Connecting..."
            : connectionStatus === "reconnecting" ? "Reconnecting..."
            : connectionStatus === "error" ? "Connection failed"
            : "Offline"}
        </div>
      </header>

      {/* Mobile tab bar — visible below lg */}
      <div className="flex lg:hidden shrink-0 border-b border-slate-100">
        {(["simulation", "transcript", "scenario"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            className={cn(
              "flex-1 py-2 text-[12px] font-medium text-center transition-colors",
              mobileTab === tab
                ? "text-slate-900 border-b-2 border-slate-900"
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            {tab === "simulation" ? "Simulation" : tab === "transcript" ? "Transcript" : "Scenario"}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — scenario context + escalation (desktop only) */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-100 bg-slate-50/50">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Your role</p>
              <p className="mt-1 text-[13px] font-medium">{traineeRole}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Speaking with</p>
              <p className="mt-1 text-[13px] font-medium">{aiRole}</p>
            </div>
            {emotionalDriver && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Emotional driver</p>
                <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{emotionalDriver}</p>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200/60">
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">{statusHeading}</p>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn("text-3xl font-bold tabular-nums leading-none", ec.text)}>{escalationLevel}</span>
                <span className="text-[12px] text-slate-400 pb-0.5">/10</span>
              </div>
              <p className="mt-1 text-[12px] font-medium text-slate-600">{ESCALATION_LABELS[escalationLevel]}</p>
              <div className="mt-3 flex gap-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-300",
                    i < escalationLevel ? ec.bar : i < maxCeiling ? "bg-slate-200" : "bg-slate-100"
                  )} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                <span>Settled</span>
                <span>Critical</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Centre — waveform and controls */}
        <main className={cn(
          "flex flex-1 flex-col items-center justify-center px-4 sm:px-6 py-6 sm:py-8",
          mobileTab !== "simulation" && "hidden lg:flex"
        )}>
          {/* Compact escalation indicator for mobile */}
          <div className="mb-4 flex w-full max-w-lg flex-col gap-2 lg:hidden">
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">{statusHeading}</p>
            <div className="flex items-center gap-3">
              <span className={cn("text-xl font-bold tabular-nums leading-none", ec.text)}>{escalationLevel}</span>
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className={cn(
                    "h-2 w-1.5 rounded-[1px] transition-all duration-300",
                    i < escalationLevel ? ec.bar : i < maxCeiling ? "bg-slate-200" : "bg-slate-100"
                  )} />
                ))}
              </div>
              <span className="text-[11px] text-slate-400">{ESCALATION_LABELS[escalationLevel]}</span>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Settled</span>
              <span>Critical</span>
            </div>
          </div>

          {/* Status text */}
          <p className={cn("text-[11px] font-medium uppercase tracking-widest mb-6",
            botActive ? "text-indigo-500"
              : isSpeaking ? "text-orange-500"
              : connectionStatus === "connected" ? "text-emerald-500"
              : "text-slate-400"
          )}>
            {supportStatusText}
          </p>

          {/* Waveform */}
          <div className="w-full max-w-lg">
            <Waveform
              audioEl={audioElement}
              isActive={connectionStatus === "connected"}
              escalationLevel={escalationLevel}
            />
          </div>

          {/* Controls */}
          <div className="mt-8 sm:mt-10 flex flex-wrap items-center justify-center gap-3">
            {botActive ? (
              <button
                onClick={stopBot}
                className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
              >
                <Hand className="h-4 w-4" />
                Resume conversation
              </button>
            ) : (
              <>
                <button
                  onClick={handleToggleMic}
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full transition-all shadow-sm",
                    micMuted
                      ? "bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  )}
                  aria-label={micMuted ? "Unmute" : "Mute"}
                >
                  {micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button
                  onClick={startBot}
                  disabled={connectionStatus !== "connected"}
                  className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-medium text-indigo-700 shadow-sm transition-colors hover:bg-indigo-100 disabled:opacity-40"
                >
                  <Bot className="h-3.5 w-3.5" />
                  Ask AI clinician for help
                </button>
              </>
            )}
            <button
              onClick={() => handleEndSession("normal")}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-[13px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              <Square className="h-3.5 w-3.5" />
              End scenario
            </button>
          </div>
          <p className="mt-4 max-w-lg text-center text-[12px] leading-relaxed text-slate-500">
            {supportHelperText}
          </p>
        </main>

        {/* Transcript panel — desktop sidebar or mobile tab */}
        <aside className={cn(
          "flex-col border-l border-slate-100",
          mobileTab === "transcript" ? "flex flex-1 lg:w-80 lg:shrink-0 lg:flex-initial" : "hidden lg:flex w-80 shrink-0"
        )}>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-[12px] font-medium text-slate-500">Transcript</span>
            <span className="text-[11px] tabular-nums text-slate-400">{transcriptEntries.length} turns</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <LiveTranscript entries={transcriptEntries} currentAiText={currentAiText} aiLabel={aiRole} />
          </div>
        </aside>

        {/* Scenario info panel — mobile only */}
        {mobileTab === "scenario" && (
          <div className="flex flex-1 flex-col lg:hidden overflow-y-auto p-5 space-y-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Your role</p>
              <p className="mt-1 text-[14px] font-medium">{traineeRole}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Speaking with</p>
              <p className="mt-1 text-[14px] font-medium">{aiRole}</p>
            </div>
            {emotionalDriver && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Emotional driver</p>
                <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{emotionalDriver}</p>
              </div>
            )}
            {setting && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Setting</p>
                <p className="mt-1 text-[13px] text-slate-600">{setting}</p>
              </div>
            )}

            <div className="pt-3 border-t border-slate-200/60">
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">{statusHeading}</p>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn("text-3xl font-bold tabular-nums leading-none", ec.text)}>{escalationLevel}</span>
                <span className="text-[12px] text-slate-400 pb-0.5">/10</span>
              </div>
              <p className="mt-1 text-[13px] font-medium text-slate-600">{ESCALATION_LABELS[escalationLevel]}</p>
              <div className="mt-3 flex gap-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className={cn(
                    "h-2 flex-1 rounded-full transition-all duration-300",
                    i < escalationLevel ? ec.bar : i < maxCeiling ? "bg-slate-200" : "bg-slate-100"
                  )} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
                <span>Settled</span>
                <span>Critical</span>
              </div>
            </div>

            <div className="pt-3">
              <span className="text-[12px] tabular-nums text-slate-400">{formatTime(elapsed)} elapsed</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
