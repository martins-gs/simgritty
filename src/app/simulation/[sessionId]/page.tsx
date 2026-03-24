"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSimulationStore } from "@/store/simulationStore";
import { useRealtimeSession } from "@/hooks/useRealtimeSession";
import { EscalationEngine } from "@/lib/engine/escalationEngine";
import { buildPrompt } from "@/lib/engine/promptBuilder";
import { Waveform } from "@/components/simulation/Waveform";
import { LiveTranscript, type TranscriptEntry } from "@/components/simulation/LiveTranscript";
import { ExitButton } from "@/components/simulation/ExitButton";
import { Mic, MicOff, Square, MapPin, Bot, Hand } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESCALATION_LABELS } from "@/types/escalation";
import type { ScenarioTraits, ScenarioVoiceConfig, EscalationRules } from "@/types/scenario";

function escColor(level: number) {
  if (level <= 2) return { bar: "bg-emerald-500", text: "text-emerald-600", ring: "ring-emerald-500/20" };
  if (level <= 4) return { bar: "bg-amber-500", text: "text-amber-600", ring: "ring-amber-500/20" };
  if (level <= 6) return { bar: "bg-orange-500", text: "text-orange-600", ring: "ring-orange-500/20" };
  if (level <= 8) return { bar: "bg-red-500", text: "text-red-600", ring: "ring-red-500/20" };
  return { bar: "bg-red-700", text: "text-red-700", ring: "ring-red-700/20" };
}

export default function SimulationPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const { connect, disconnect, updateSession, cancelCurrentResponse, setMicEnabled, sendEvent, audioElRef } = useRealtimeSession();

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

        const traits = extractChild(snapshot.scenario_traits) as unknown as ScenarioTraits;
        const voiceConfig = extractChild(snapshot.scenario_voice_config) as unknown as ScenarioVoiceConfig;
        const escalationRules = extractChild(snapshot.escalation_rules) as unknown as EscalationRules;
        const ceiling = Math.min(escalationRules.max_ceiling, 8);
        setMaxCeiling(ceiling);

        const engine = new EscalationEngine(escalationRules, traits, ceiling);
        engineRef.current = engine;
        setEscalationLevel(engine.getLevel());
        peakLevelRef.current = engine.getLevel();

        const instructions = buildPrompt({
          title: snapshot.title, aiRole: snapshot.ai_role, traineeRole: snapshot.trainee_role,
          backstory: snapshot.backstory, emotionalDriver: snapshot.emotional_driver, setting: snapshot.setting,
          traits, voiceConfig, escalationRules, currentState: engine.getState(), recentTurns: [],
        });

        const startRes = await fetch(`/api/sessions/${sessionId}/start`, { method: "POST", signal: abortController.signal });
        if (cancelled) return;
        if (!startRes.ok) throw new Error("Failed to start session");

        await connect({
          voice: voiceConfig.voice_name || "ash", instructions,
          onTraineeTranscript: handleTraineeTranscript,
          onAiTranscript: handleAiTranscriptDone,
          onAiTranscriptDelta: handleAiDelta,
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

  const handleAiDelta = useCallback((delta: string) => {
    aiSpeakingRef.current = true;
    setCurrentAiText((prev) => prev + delta);
    setIsSpeaking(true);
  }, []);

  const handleAiTranscriptDone = useCallback((text: string) => {
    aiSpeakingRef.current = false; setCurrentAiText(""); setIsSpeaking(false);
    setTranscriptEntries((prev) => [...prev, { speaker: "ai", content: text, timestamp: new Date().toISOString() }]);
    const idx = turnIndexRef.current++;
    fetch(`/api/sessions/${sessionId}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_index: idx, speaker: "ai", content: text }) });
    if (pendingUpdateRef.current) { updateSession(pendingUpdateRef.current); pendingUpdateRef.current = null; }
  }, [sessionId, updateSession]);

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

      const traits = extractChild(snapshot.scenario_traits) as unknown as ScenarioTraits;
      const voiceConfig = extractChild(snapshot.scenario_voice_config) as unknown as ScenarioVoiceConfig;
      const escalationRules = extractChild(snapshot.escalation_rules) as unknown as EscalationRules;
      const newInstructions = buildPrompt({ title: snapshot.title as string, aiRole: snapshot.ai_role as string, traineeRole: snapshot.trainee_role as string, backstory: snapshot.backstory as string, emotionalDriver: snapshot.emotional_driver as string, setting: snapshot.setting as string, traits, voiceConfig, escalationRules, currentState: newState, recentTurns: transcriptRef.current.slice(-20).map((e) => ({ speaker: e.speaker, content: e.content })) });

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

      // Update prompt for next patient response
      const traits = extractChild(snapshot.scenario_traits) as unknown as ScenarioTraits;
      const voiceConfig = extractChild(snapshot.scenario_voice_config) as unknown as ScenarioVoiceConfig;
      const escalationRules = extractChild(snapshot.escalation_rules) as unknown as EscalationRules;
      const newInstructions = buildPrompt({ title: snapshot.title as string, aiRole: snapshot.ai_role as string, traineeRole: snapshot.trainee_role as string, backstory: snapshot.backstory as string, emotionalDriver: snapshot.emotional_driver as string, setting: snapshot.setting as string, traits, voiceConfig, escalationRules, currentState: newState, recentTurns: transcriptRef.current.slice(-20).map((e) => ({ speaker: e.speaker, content: e.content })) });
      updateSession(newInstructions);
    } catch (err) {
      console.error("[Bot] Classification error:", err);
    }
  }

  function speakWithSynthesis(text: string): Promise<void> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.rate = 0.95;
      // Try to pick a non-default voice
      const voices = speechSynthesis.getVoices();
      const britishVoice = voices.find((v) => v.lang.startsWith("en-GB") && v.name.includes("Female"))
        || voices.find((v) => v.lang.startsWith("en-GB"))
        || voices.find((v) => v.lang.startsWith("en"));
      if (britishVoice) utterance.voice = britishVoice;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      speechSynthesis.speak(utterance);
    });
  }

  async function runBotTurn(abort: AbortController) {
    if (abort.signal.aborted || !botActiveRef.current) return;

    setBotSpeaking(true);
    const snapshot = scenarioRef.current;
    if (!snapshot) return;

    // Generate de-escalation response
    const recentTurns = transcriptRef.current.slice(-8).map((e) => ({ speaker: e.speaker, content: e.content }));
    const res = await fetch("/api/deescalate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recentTurns,
        escalationLevel: engineRef.current?.getLevel() ?? 5,
        scenarioContext: `${snapshot.setting} - ${snapshot.ai_role} speaking with ${snapshot.trainee_role}. Emotional driver: ${snapshot.emotional_driver}`,
      }),
      signal: abort.signal,
    }).catch(() => null);

    if (!res || abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    const { text, technique } = await res.json();
    console.log("[Bot] Generated:", text, "| Technique:", technique);

    // Add to transcript
    const entry: TranscriptEntry = { speaker: "system", content: text, timestamp: new Date().toISOString() };
    setTranscriptEntries((prev) => [...prev, entry]);
    const idx = turnIndexRef.current++;
    fetch(`/api/sessions/${sessionId}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn_index: idx, speaker: "system", content: text }) });

    // Speak it aloud via browser TTS
    await speakWithSynthesis(text);
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    // Classify the bot's utterance through the escalation engine
    await classifyBotUtterance(text);
    if (abort.signal.aborted || !botActiveRef.current) { setBotSpeaking(false); return; }

    setBotSpeaking(false);

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
      const check = setInterval(() => {
        if (abort.signal.aborted || !botActiveRef.current || !aiSpeakingRef.current === false) {
          // Wait until AI finishes speaking
          if (!aiSpeakingRef.current) {
            clearInterval(check);
            // Small pause after patient finishes before bot responds
            setTimeout(resolve, 800);
          }
        }
        if (abort.signal.aborted) {
          clearInterval(check);
          resolve();
        }
      }, 200);
    });
  }

  function startBot() {
    botActiveRef.current = true;
    setBotActive(true);
    setMicEnabled(false);

    const abort = new AbortController();
    botAbortRef.current = abort;

    // Wait a beat then start the first bot turn
    setTimeout(() => runBotTurn(abort), 500);
  }

  function stopBot() {
    botActiveRef.current = false;
    setBotActive(false);
    setBotSpeaking(false);
    speechSynthesis.cancel();
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
