"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSimulationStore } from "@/store/simulationStore";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import { useRealtimeVoiceRenderer } from "@/hooks/useRealtimeVoiceRenderer";
import { EscalationEngine } from "@/lib/engine/escalationEngine";
import { buildPrompt } from "@/lib/engine/promptBuilder";
import {
  buildClinicianRealtimeInstructions,
  buildClinicianRealtimeInstructionsFromProfile,
  type ClinicianVoiceContext,
} from "@/lib/engine/clinicianVoiceBuilder";
import { Waveform } from "@/components/simulation/Waveform";
import { LiveTranscript, type TranscriptEntry } from "@/components/simulation/LiveTranscript";
import { ExitButton } from "@/components/simulation/ExitButton";
import { Mic, MicOff, Square, MapPin, Bot, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESCALATION_LABELS } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig, EscalationRules } from "@/types/scenario";
import type { ClassifierResult } from "@/types/simulation";
import type { StructuredVoiceProfile } from "@/types/voice";

function escColor(level: number) {
  if (level <= 2) return { bar: "bg-emerald-500", text: "text-emerald-600", ring: "ring-emerald-500/20" };
  if (level <= 4) return { bar: "bg-amber-500", text: "text-amber-600", ring: "ring-amber-500/20" };
  if (level <= 6) return { bar: "bg-orange-500", text: "text-orange-600", ring: "ring-orange-500/20" };
  if (level <= 8) return { bar: "bg-red-500", text: "text-red-600", ring: "ring-red-500/20" };
  return { bar: "bg-red-700", text: "text-red-700", ring: "ring-red-700/20" };
}

const CLINICIAN_REALTIME_VOICE = "cedar";
const CLINICIAN_REALTIME_HANDOFF_DELAY_MS = 150;
const BOT_TURN_POST_PATIENT_DELAY_MS = 100;

interface PreparedBotTurn {
  text: string;
  technique: string;
  voiceProfile: StructuredVoiceProfile | null;
}

export default function SimulationPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { connect, disconnect, updateSession, cancelCurrentResponse, setMicEnabled, sendEvent, audioElRef } = useRealtimeSession();
  const {
    connect: connectClinicianRenderer,
    disconnect: disconnectClinicianRenderer,
    speakText: speakWithClinicianRenderer,
  } = useRealtimeVoiceRenderer();

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
  const [lastClassification, setLastClassification] = useState<{ technique: string; effectiveness: number } | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [botActive, setBotActive] = useState(false);
  const [botSpeaking, setBotSpeaking] = useState(false);

  const engineRef = useRef<EscalationEngine | null>(null);
  const turnIndexRef = useRef(0);
  const eventIndexRef = useRef(1);
  const peakLevelRef = useRef(3);
  const scenarioRef = useRef<Record<string, unknown> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const aiSpeakingRef = useRef(false);
  const pendingUpdateRef = useRef<string | null>(null);
  const classifyingRef = useRef(false);
  const endingRef = useRef(false);
  const botActiveRef = useRef(false);
  const botAbortRef = useRef<AbortController | null>(null);
  const patientVoiceProfileRef = useRef<StructuredVoiceProfile | null>(null);
  const patientVoiceRequestRef = useRef(0);
  const pendingPatientReplyUpdateRef = useRef<Promise<void> | null>(null);
  const patientReplyUpdateRequestRef = useRef(0);
  const clinicianRendererReadyRef = useRef(false);
  const clinicianRendererConnectRef = useRef<Promise<boolean> | null>(null);
  const clinicianRendererErrorRef = useRef<string | null>(null);
  const pendingBotTurnRef = useRef<Promise<PreparedBotTurn | null> | null>(null);
  const pendingBotTurnRequestRef = useRef(0);

  useEffect(() => { transcriptRef.current = transcriptEntries; }, [transcriptEntries]);

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

        const session = await sessionRes.json();
        if (cancelled) return;
        const snapshot = session.scenario_snapshot;
        scenarioRef.current = snapshot;

        const { traits, voiceConfig, escalationRules } = getScenarioConfig(snapshot);
        const ceiling = Math.min(escalationRules.max_ceiling, 8);
        setMaxCeiling(ceiling);

        const engine = new EscalationEngine(escalationRules, traits, ceiling);
        engineRef.current = engine;
        setEscalationLevel(engine.getLevel());
        peakLevelRef.current = engine.getLevel();

        const instructions = await resolvePatientInstructions(snapshot, engine.getState(), [], abortController.signal)
          ?? buildPatientInstructions(snapshot, engine.getState(), [], patientVoiceProfileRef.current);

        const startRes = await fetch(`/api/sessions/${sessionId}/start`, { method: "POST", signal: abortController.signal });
        if (cancelled) return;
        if (!startRes.ok) throw new Error("Failed to start session");

        await connect({
          voice: voiceConfig.voice_name || "marin", instructions,
          onTraineeTranscript: handleTraineeTranscript,
          onAiTranscript: handleAiTranscriptDone,
          onAiTranscriptDelta: handleAiDelta,
          onAiPlaybackComplete: handleAiPlaybackComplete,
          onError: (err) => console.error("Realtime error:", err),
        });
        if (cancelled) { disconnect(); return; }

        setScenarioLoaded(true);
        timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      } catch (err) {
        if (abortController.signal.aborted || cancelled) return;
        console.error("Simulation init error:", err);
        router.push("/dashboard");
      }
    }
    init();
    return () => { cancelled = true; abortController.abort(); if (timerRef.current) clearInterval(timerRef.current); disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function extractChild(data: unknown): Record<string, unknown> {
    if (Array.isArray(data) && data.length > 0) return data[0] as Record<string, unknown>;
    if (data && typeof data === "object") return data as Record<string, unknown>;
    return {} as Record<string, unknown>;
  }

  function getScenarioConfig(snapshot: Record<string, unknown>) {
    return {
      traits: extractChild(snapshot.scenario_traits) as unknown as ScenarioTraits,
      voiceConfig: extractChild(snapshot.scenario_voice_config) as unknown as ScenarioVoiceConfig,
      escalationRules: extractChild(snapshot.escalation_rules) as unknown as EscalationRules,
    };
  }

  function getRecentPromptTurns() {
    return transcriptRef.current
      .slice(-20)
      .map((entry) => ({ speaker: entry.speaker, content: entry.content }));
  }

  function buildPatientInstructions(
    snapshot: Record<string, unknown>,
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
    snapshot: Record<string, unknown>,
    currentState: ReturnType<EscalationEngine["getState"]>,
    recentTurns: { speaker: string; content: string }[],
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
      }),
      signal,
    }).catch(() => null);

    if (!res || !res.ok) return null;

    const data = await res.json() as { voiceProfile?: StructuredVoiceProfile | null };
    return data.voiceProfile || null;
  }

  async function resolvePatientInstructions(
    snapshot: Record<string, unknown>,
    currentState: ReturnType<EscalationEngine["getState"]>,
    recentTurns: { speaker: string; content: string }[],
    signal?: AbortSignal
  ): Promise<string | null> {
    const requestId = patientVoiceRequestRef.current + 1;
    patientVoiceRequestRef.current = requestId;

    const voiceProfile = await fetchPatientVoiceProfile(snapshot, currentState, recentTurns, signal);
    if (signal?.aborted || requestId !== patientVoiceRequestRef.current) return null;

    if (voiceProfile) {
      patientVoiceProfileRef.current = voiceProfile;
    }

    return buildPatientInstructions(
      snapshot,
      currentState,
      recentTurns,
      voiceProfile ?? patientVoiceProfileRef.current
    );
  }

  async function requestBotTurn(
    requestId: number,
    signal?: AbortSignal
  ): Promise<PreparedBotTurn | null> {
    const snapshot = scenarioRef.current;
    const state = engineRef.current?.getState();
    if (!snapshot || !state || !botActiveRef.current) return null;

    const recentTurns = transcriptRef.current.slice(-8).map((entry) => ({
      speaker: entry.speaker,
      content: entry.content,
    }));

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
        patientVoiceProfile: patientVoiceProfileRef.current,
      }),
      signal,
    }).catch(() => null);

    if (
      !res ||
      signal?.aborted ||
      !botActiveRef.current ||
      requestId !== pendingBotTurnRequestRef.current
    ) {
      return null;
    }

    return await res.json() as PreparedBotTurn;
  }

  function prefetchNextBotTurn(signal?: AbortSignal) {
    const requestId = pendingBotTurnRequestRef.current + 1;
    pendingBotTurnRequestRef.current = requestId;
    console.info(`[Bot] Prefetching clinician turn request_id=${requestId}`);
    pendingBotTurnRef.current = requestBotTurn(requestId, signal);
  }

  async function consumeBotTurn(signal?: AbortSignal): Promise<PreparedBotTurn | null> {
    const prefetched = pendingBotTurnRef.current;
    pendingBotTurnRef.current = null;

    if (prefetched) {
      const resolved = await prefetched;
      if (resolved || signal?.aborted || !botActiveRef.current) {
        return resolved;
      }
    }

    const requestId = pendingBotTurnRequestRef.current + 1;
    pendingBotTurnRequestRef.current = requestId;
    console.info(`[Bot] Generating clinician turn on demand request_id=${requestId}`);
    return requestBotTurn(requestId, signal);
  }

  async function syncPatientStateFromBotReply(text: string, requestId: number): Promise<void> {
    if (!engineRef.current || !scenarioRef.current || !botActiveRef.current) return;
    const snapshot = scenarioRef.current;
    const isStale = () =>
      requestId !== patientReplyUpdateRequestRef.current || !botActiveRef.current || endingRef.current;
    const recentTurns = transcriptRef.current.slice(-4).map((entry) => ({ speaker: entry.speaker, content: entry.content }));

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
          },
        }),
      }).catch(() => null);

      if (!res || !res.ok || isStale() || !engineRef.current) return;

      const classResult = await res.json() as ClassifierResult;
      if (isStale() || !engineRef.current) return;

      console.log("[Bot Patient State] Classifier:", classResult);

      const prevState = engineRef.current.getState();
      const delta = engineRef.current.processClassification(classResult);
      const newState = engineRef.current.getState();
      if (isStale()) return;

      console.log("[Bot Patient State]", prevState.level, "→", newState.level, delta.trigger_type);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      if (engineRef.current.shouldAutoEnd()) {
        handleEndSession("auto_ceiling");
        return;
      }

      if (!isStale()) {
        prefetchNextBotTurn(botAbortRef.current?.signal);
      }

      const evtIdx = eventIndexRef.current++;
      fetch(`/api/sessions/${sessionId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      void (async () => {
        const newInstructions = await resolvePatientInstructions(snapshot, newState, getRecentPromptTurns());
        if (isStale()) return;
        if (newInstructions) {
          updateSession(newInstructions);
        }
      })();
    } catch (err) {
      if (isStale()) return;
      console.error("[Bot Patient State] Classification error:", err);
    }
  }

  function queuePatientReplyStateUpdate(text: string) {
    const requestId = patientReplyUpdateRequestRef.current + 1;
    patientReplyUpdateRequestRef.current = requestId;

    const pending = syncPatientStateFromBotReply(text, requestId);
    pendingPatientReplyUpdateRef.current = pending;

    void pending.finally(() => {
      if (pendingPatientReplyUpdateRef.current === pending) {
        pendingPatientReplyUpdateRef.current = null;
      }
    });
  }

  const handleAiDelta = useCallback((delta: string) => {
    aiSpeakingRef.current = true;
    setCurrentAiText((prev) => prev + delta);
    setIsSpeaking(true);
  }, []);

  function handleAiTranscriptDone(text: string) {
    const entry = { speaker: "ai", content: text, timestamp: new Date().toISOString() } as const;
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscriptEntries((prev) => [...prev, entry]);
    const idx = turnIndexRef.current++;
    fetch(`/api/sessions/${sessionId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turn_index: idx, speaker: "ai", content: text }),
    });
    if (botActiveRef.current) {
      queuePatientReplyStateUpdate(text);
    }
    if (pendingUpdateRef.current) {
      updateSession(pendingUpdateRef.current);
      pendingUpdateRef.current = null;
    }
  }

  function handleAiPlaybackComplete() {
    aiSpeakingRef.current = false;
    setCurrentAiText("");
    setIsSpeaking(false);
  }

  const handleTraineeTranscript = useCallback(async (text: string) => {
    setTranscriptEntries((prev) => [...prev, { speaker: "trainee", content: text, timestamp: new Date().toISOString() }]);
    const idx = turnIndexRef.current++;
    fetch(`/api/sessions/${sessionId}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_index: idx, speaker: "trainee", content: text }) });

    if (classifyingRef.current || !engineRef.current || !scenarioRef.current) return;
    classifyingRef.current = true;
    const snapshot = scenarioRef.current;
    const recentTurns = transcriptRef.current.slice(-4).map((e) => ({ speaker: e.speaker, content: e.content }));

    try {
      const classifyRes = await fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text, context: { recentTurns, scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}`, currentEscalation: engineRef.current.getLevel() } }),
      });
      if (!classifyRes.ok) return;
      const classResult = await classifyRes.json();
      setLastClassification({ technique: classResult.technique, effectiveness: classResult.effectiveness });
      console.log("[Escalation] Classifier:", classResult);

      const prevState = engineRef.current.getState();
      const delta = engineRef.current.processClassification(classResult);
      const newState = engineRef.current.getState();
      console.log("[Escalation]", prevState.level, "→", newState.level, delta.trigger_type);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      const evtIdx = eventIndexRef.current++;
      fetch(`/api/sessions/${sessionId}/events`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_index: evtIdx, event_type: delta.trigger_type === "escalation" ? "escalation_change" : delta.trigger_type === "de_escalation" ? "de_escalation_change" : "classification_result", escalation_before: prevState.level, escalation_after: newState.level, trust_before: prevState.trust, trust_after: newState.trust, listening_before: prevState.willingness_to_listen, listening_after: newState.willingness_to_listen, payload: { classifier: classResult, delta } }) });

      const newInstructions = await resolvePatientInstructions(snapshot, newState, getRecentPromptTurns());
      if (!newInstructions) return;

      if (aiSpeakingRef.current) { pendingUpdateRef.current = newInstructions; } else { updateSession(newInstructions); }
      if (engineRef.current.shouldAutoEnd()) handleEndSession("auto_ceiling");
    } catch (err) { console.error("Classification error:", err); } finally { classifyingRef.current = false; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, updateSession]);

  async function handleEndSession(exitType: string = "normal") {
    if (endingRef.current) return; endingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    stopBot();
    cancelCurrentResponse();
    await new Promise((r) => setTimeout(r, 50));
    disconnect();
    fetch(`/api/sessions/${sessionId}/end`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exit_type: exitType, final_escalation_level: engineRef.current?.getLevel(), peak_escalation_level: peakLevelRef.current }) });
    router.push(`/review/${sessionId}`);
  }

  // --- AI Clinician Bot ---

  async function classifyBotUtterance(text: string) {
    if (!engineRef.current || !scenarioRef.current) return;
    const snapshot = scenarioRef.current;
    const recentTurns = transcriptRef.current.slice(-4).map((e) => ({ speaker: e.speaker, content: e.content }));

    try {
      const res = await fetch("/api/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          utterance: text,
          context: {
            recentTurns,
            scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}`,
            currentEscalation: engineRef.current.getLevel(),
          },
        }),
      });
      if (!res.ok) return;
      const classResult = await res.json();
      setLastClassification({ technique: classResult.technique, effectiveness: classResult.effectiveness });
      console.log("[Bot Escalation] Classifier:", classResult);

      const prevState = engineRef.current.getState();
      const delta = engineRef.current.processClassification(classResult);
      const newState = engineRef.current.getState();
      console.log("[Bot Escalation]", prevState.level, "→", newState.level, delta.trigger_type);

      setEscalationLevel(newState.level);
      peakLevelRef.current = Math.max(peakLevelRef.current, newState.level);

      const evtIdx = eventIndexRef.current++;
      fetch(`/api/sessions/${sessionId}/events`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_index: evtIdx, event_type: delta.trigger_type === "escalation" ? "escalation_change" : delta.trigger_type === "de_escalation" ? "de_escalation_change" : "classification_result", escalation_before: prevState.level, escalation_after: newState.level, trust_before: prevState.trust, trust_after: newState.trust, listening_before: prevState.willingness_to_listen, listening_after: newState.willingness_to_listen, payload: { classifier: classResult, delta, source: "bot_clinician" } }) });

      const newInstructions = await resolvePatientInstructions(snapshot, newState, getRecentPromptTurns());
      if (newInstructions) {
        updateSession(newInstructions);
      }
    } catch (err) {
      console.error("[Bot] Classification error:", err);
    }
  }

  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  function getClinicianVoiceContext(technique: string): ClinicianVoiceContext {
    const snapshot = scenarioRef.current;
    const state = engineRef.current?.getState();

    return {
      clinicianRole: "experienced British NHS clinician",
      patientRole: (snapshot?.ai_role as string | undefined) || "patient",
      emotionalDriver: (snapshot?.emotional_driver as string | undefined) || "",
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
  ): Promise<void> {
    const context = getClinicianVoiceContext(technique);
    console.info('[Clinician Audio] path=tts status=requested');
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, style: "clinician", context, voiceProfile }),
      signal: abort.signal,
    }).catch(() => null);

    if (!res || abort.signal.aborted) return;
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[Clinician Audio] path=tts status=failed", res.status, errText);
      return;
    }

    console.info("[Clinician Audio] path=tts status=playing");
    const blob = await res.blob();
    if (abort.signal.aborted) return;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    botAudioRef.current = audio;

    return new Promise<void>((resolve) => {
      audio.onended = () => { URL.revokeObjectURL(url); botAudioRef.current = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); botAudioRef.current = null; resolve(); };
      if (abort.signal.aborted) { URL.revokeObjectURL(url); resolve(); return; }
      audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); });
    });
  }

  async function speakWithClinicianAudio(
    text: string,
    technique: string,
    voiceProfile: StructuredVoiceProfile | null,
    abort: AbortController
  ): Promise<"realtime" | "tts" | "none"> {
    const realtimeInstructions = getClinicianRealtimeInstructions(technique, voiceProfile);
    const connected = await ensureClinicianRendererConnected(realtimeInstructions);
    if (abort.signal.aborted || !botActiveRef.current) return "none";

    if (connected) {
      console.info(`[Clinician Audio] path=realtime status=speaking voice=${CLINICIAN_REALTIME_VOICE}`);
      const rendered = await speakWithClinicianRenderer({
        text,
        instructions: realtimeInstructions,
      });

      if (abort.signal.aborted || !botActiveRef.current) return "none";

      if (rendered) {
        console.info(`[Clinician Audio] path=realtime status=done voice=${CLINICIAN_REALTIME_VOICE}`);
        return "realtime";
      }

      clinicianRendererReadyRef.current = false;
      disconnectClinicianRenderer();
      console.warn('[Clinician Audio] fallback=tts reason="renderer speak failed"');
    }

    await speakWithTtsFallback(text, technique, voiceProfile, abort);
    if (abort.signal.aborted || !botActiveRef.current) return "none";
    return "tts";
  }

  async function runBotTurn(abort: AbortController) {
    if (abort.signal.aborted || !botActiveRef.current) return;

    setBotSpeaking(true);
    const preparedTurn = await consumeBotTurn(abort.signal);
    if (!preparedTurn || abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    const { text, technique, voiceProfile } = preparedTurn;
    console.log("[Bot] Generated:", text, "| Technique:", technique);

    // Add to transcript
    const entry: TranscriptEntry = { speaker: "system", content: text, timestamp: new Date().toISOString() };
    transcriptRef.current = [...transcriptRef.current, entry];
    setTranscriptEntries((prev) => [...prev, entry]);
    const idx = turnIndexRef.current++;
    fetch(`/api/sessions/${sessionId}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_index: idx, speaker: "system", content: text }) });

    const botClassificationPromise = classifyBotUtterance(text);
    const clinicianAudioPath = await speakWithClinicianAudio(text, technique, voiceProfile, abort);
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    if (clinicianAudioPath === "realtime") {
      console.info(`[Clinician Audio] path=realtime status=handoff_wait delay_ms=${CLINICIAN_REALTIME_HANDOFF_DELAY_MS}`);
      await new Promise((resolve) => setTimeout(resolve, CLINICIAN_REALTIME_HANDOFF_DELAY_MS));
      if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }
    }

    // Most of this work should already be done while the clinician is speaking.
    await botClassificationPromise;
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    setBotSpeaking(false);

    // Cancel any in-flight patient response before injecting the bot's reply
    cancelCurrentResponse();

    // Inject the bot's text into the Realtime session so the patient hears and responds
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
      const check = setInterval(() => {
        if (abort.signal.aborted || !botActiveRef.current) {
          clearInterval(check);
          resolve();
          return;
        }

        if (aiSpeakingRef.current) {
          sawPatientSpeaking = true;
          return;
        }

        if (sawPatientSpeaking) {
          clearInterval(check);
          void (async () => {
            const pendingStateUpdate = pendingPatientReplyUpdateRef.current;
            if (pendingStateUpdate) {
              await pendingStateUpdate;
            }
            if (abort.signal.aborted || !botActiveRef.current) {
              resolve();
              return;
            }
            setTimeout(resolve, BOT_TURN_POST_PATIENT_DELAY_MS);
          })();
          return;
        }
      }, 50);
    });
  }

  function startBot() {
    botActiveRef.current = true;
    setBotActive(true);
    setMicEnabled(false);

    const abort = new AbortController();
    botAbortRef.current = abort;

    const warmupInstructions = getClinicianRealtimeInstructions(
      "general de-escalation",
      null
    );
    void ensureClinicianRendererConnected(warmupInstructions);
    prefetchNextBotTurn(abort.signal);

    // Wait a beat then start the first bot turn
    setTimeout(() => runBotTurn(abort), 500);
  }

  function stopBot() {
    patientReplyUpdateRequestRef.current += 1;
    pendingPatientReplyUpdateRef.current = null;
    pendingBotTurnRequestRef.current += 1;
    pendingBotTurnRef.current = null;
    clinicianRendererReadyRef.current = false;
    clinicianRendererConnectRef.current = null;
    botActiveRef.current = false;
    setBotActive(false);
    setBotSpeaking(false);
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
    // Re-enable mic
    const userMuted = useSimulationStore.getState().micMuted;
    if (!userMuted) setMicEnabled(true);
  }

  function handleToggleMic() { toggleMic(); setMicEnabled(micMuted); }
  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const ec = escColor(escalationLevel);
  const title = (scenarioRef.current?.title as string) || "Simulation";
  const setting = (scenarioRef.current?.setting as string) || "";
  const aiRole = (scenarioRef.current?.ai_role as string) || "Patient";
  const traineeRole = (scenarioRef.current?.trainee_role as string) || "Clinician";
  const emotionalDriver = (scenarioRef.current?.emotional_driver as string) || "";

  if (!scenarioLoaded) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
          <p className="mt-4 text-[13px] text-slate-500">Connecting to simulation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 px-5">
        <div className="flex items-center gap-4 min-w-0">
          <h1 className="text-[14px] font-semibold truncate">{title}</h1>
          <div className="hidden sm:flex items-center gap-3 text-[12px] text-slate-400">
            {setting && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{setting}</span>}
            <span className="tabular-nums">{formatTime(elapsed)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {/* Escalation level — always visible, discreet */}
          <div className="flex items-center gap-1.5">
            <div className="flex gap-px">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className={cn(
                  "h-3 w-1 rounded-[1px] transition-all duration-300",
                  i < escalationLevel ? ec.bar : "bg-slate-200"
                )} />
              ))}
            </div>
            <span className={cn("text-[11px] font-semibold tabular-nums", ec.text)}>{escalationLevel}</span>
          </div>
          <div className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            connectionStatus === "connected" ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-400"
          )}>
            <span className={cn("h-1.5 w-1.5 rounded-full", connectionStatus === "connected" ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
            {connectionStatus === "connected" ? "Live" : connectionStatus === "connecting" ? "Connecting..." : "Offline"}
          </div>
          <ExitButton onClick={() => handleEndSession("instant_exit")} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — scenario context + escalation */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-100 bg-slate-50/50">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Roles */}
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

            {/* Escalation */}
            <div className="pt-2 border-t border-slate-200/60">
              <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Escalation</p>
              <div className="mt-2 flex items-end gap-2">
                <span className={cn("text-3xl font-bold tabular-nums leading-none", ec.text)}>{escalationLevel}</span>
                <span className="text-[12px] text-slate-400 pb-0.5">/10</span>
              </div>
              <p className="mt-1 text-[12px] font-medium text-slate-600">{ESCALATION_LABELS[escalationLevel]}</p>

              {/* Bar */}
              <div className="mt-3 flex gap-1">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i} className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-300",
                    i < escalationLevel ? ec.bar : i < maxCeiling ? "bg-slate-200" : "bg-slate-100"
                  )} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
                <span>Calm</span>
                <span>Ceiling {maxCeiling}</span>
              </div>
            </div>

            {/* Last classification */}
            {lastClassification && (
              <div className="pt-2 border-t border-slate-200/60">
                <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Last assessment</p>
                <p className="mt-1 text-[12px] font-medium text-slate-700">{lastClassification.technique}</p>
                <p className={cn("text-[11px] font-medium",
                  lastClassification.effectiveness > 0.3 ? "text-emerald-600" : lastClassification.effectiveness < -0.3 ? "text-red-600" : "text-slate-500"
                )}>
                  {lastClassification.effectiveness > 0 ? "+" : ""}{lastClassification.effectiveness.toFixed(1)} effectiveness
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Centre — waveform and controls */}
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">
          {/* Status text */}
          <p className={cn("text-[11px] font-medium uppercase tracking-widest mb-6",
            botActive ? "text-indigo-500"
              : isSpeaking ? "text-orange-500"
              : connectionStatus === "connected" ? "text-emerald-500"
              : "text-slate-400"
          )}>
            {botActive
              ? (botSpeaking ? "AI Clinician is speaking" : isSpeaking ? `${aiRole} is responding` : "AI Clinician — preparing next response")
              : isSpeaking ? `${aiRole} is speaking`
              : connectionStatus === "connected" ? "Listening — speak when ready"
              : "Connecting..."}
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
          <div className="mt-10 flex items-center gap-3">
            {botActive ? (
              <button
                onClick={stopBot}
                className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
              >
                <Hand className="h-4 w-4" />
                Take over
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
                  De-escalate
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
        </main>

        {/* Right panel — transcript */}
        <aside className="hidden md:flex w-80 shrink-0 flex-col border-l border-slate-100">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-[12px] font-medium text-slate-500">Transcript</span>
            <span className="text-[11px] tabular-nums text-slate-400">{transcriptEntries.length} turns</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <LiveTranscript entries={transcriptEntries} currentAiText={currentAiText} />
          </div>
        </aside>
      </div>
    </div>
  );
}
