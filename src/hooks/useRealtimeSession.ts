"use client";

import { useRef, useCallback, useEffect } from "react";
import { useSimulationStore } from "@/store/simulationStore";

interface RealtimeSessionConfig {
  voice: string;
  instructions: string;
  onTraineeTranscript: (text: string) => void;
  onAiTranscript: (text: string) => void;
  onAiTranscriptDelta: (delta: string) => void;
  onAiPlaybackComplete: () => void;
  // Called by the safety timer when the buffer-stopped event hasn't arrived
  // after response.done.  This should update the UI and ungate the mic
  // (so the trainee can speak) but NOT mark the AI as "no longer speaking"
  // for programmatic turn-taking, because audio may still be playing from
  // the WebRTC buffer.
  onAiPlaybackSafetyTimeout?: () => void;
  onError: (error: string) => void;
}

const DEFAULT_TURN_DETECTION = {
  type: "server_vad" as const,
  threshold: 0.55,
  prefix_padding_ms: 300,
  silence_duration_ms: 320,
  interrupt_response: false,
  create_response: true,
};

function isLikelyEnglish(text: string) {
  return /^[a-zA-Z0-9\s.,!?'";\-:()\/&@#$%+=\[\]{}*_~`<>]+$/.test(text);
}

export function useRealtimeSession() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connectAttemptRef = useRef(0);
  const disconnectedRef = useRef(false);
  const activeResponseIdRef = useRef<string | null>(null);
  // Mic gating: mute mic while AI speaks to prevent echo feedback loop
  const micGatedRef = useRef(false);
  const micForcedOffRef = useRef(false);
  const unmutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Safety timer: force-clear speaking state if the buffer-stopped event
  // never arrives after the response completes.
  const playbackSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deduplication
  const lastTraineeTextRef = useRef("");
  const lastTraineeTimeRef = useRef(0);

  const setConnectionStatus = useSimulationStore((s) => s.setConnectionStatus);

  // Low-level mic control — sets the actual track enabled state
  const setMicTrackEnabled = useCallback((enabled: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }, []);

  // Gate the mic off while AI is producing audio.
  // This is the primary defence against the echo feedback loop.
  const gateMic = useCallback(() => {
    micGatedRef.current = true;
    if (unmutTimerRef.current) {
      clearTimeout(unmutTimerRef.current);
      unmutTimerRef.current = null;
    }
    setMicTrackEnabled(false);
  }, [setMicTrackEnabled]);

  // Ungate the mic after AI finishes, with a grace period for echo tail
  const ungateMic = useCallback(() => {
    if (unmutTimerRef.current) clearTimeout(unmutTimerRef.current);
    unmutTimerRef.current = setTimeout(() => {
      micGatedRef.current = false;
      // Only re-enable if user hasn't manually muted
      const userMuted = useSimulationStore.getState().micMuted;
      if (!userMuted && !micForcedOffRef.current) {
        setMicTrackEnabled(true);
      }
      unmutTimerRef.current = null;
    }, 200); // short grace period keeps turn-taking snappy without reopening echo immediately
  }, [setMicTrackEnabled]);

  function teardownConnectionResources(
    pc: RTCPeerConnection | null,
    dc: RTCDataChannel | null,
    audioEl: HTMLAudioElement | null,
    localStream: MediaStream | null
  ) {
    if (audioEl) {
      const remoteStream = audioEl.srcObject as MediaStream | null;
      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
      }
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.src = "";
      audioEl.load();
      audioEl.remove();
    }

    if (dc) {
      try {
        dc.close();
      } catch {}
    }

    if (pc) {
      try {
        pc.getSenders().forEach((sender) => {
          if (sender.track) sender.track.stop();
        });
        pc.getReceivers().forEach((receiver) => {
          if (receiver.track) receiver.track.stop();
        });
        pc.close();
      } catch {}
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
  }

  const handleServerEvent = useCallback((
    msg: Record<string, unknown>,
    config: RealtimeSessionConfig
  ) => {
    const type = msg.type as string;

    switch (type) {
      case "response.created": {
        const response = msg.response as { id?: string } | undefined;
        if (response?.id) {
          activeResponseIdRef.current = response.id;
          // AI is about to speak — mute the mic to prevent echo loop
          gateMic();
        }
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const transcript = (msg.transcript as string)?.trim();
        if (!transcript) break;

        // The mic track is disabled while the echo gate is active, so no new audio
        // reaches the API during gating. Any transcript arriving while gated is from
        // speech captured BEFORE the gate activated — it is real trainee speech, not echo.
        // We no longer drop these transcripts.

        // Drop non-English hallucinations
        if (!isLikelyEnglish(transcript)) break;

        // Deduplicate
        const now = Date.now();
        if (
          transcript === lastTraineeTextRef.current &&
          now - lastTraineeTimeRef.current < 3000
        ) {
          break;
        }
        lastTraineeTextRef.current = transcript;
        lastTraineeTimeRef.current = now;

        config.onTraineeTranscript(transcript);
        break;
      }

      case "response.audio_transcript.delta": {
        const responseId = msg.response_id as string | undefined;
        if (responseId && responseId !== activeResponseIdRef.current) break;
        const delta = msg.delta as string;
        if (delta) config.onAiTranscriptDelta(delta);
        break;
      }

      case "response.audio_transcript.done": {
        const responseId = msg.response_id as string | undefined;
        if (responseId && responseId !== activeResponseIdRef.current) break;
        const transcript = (msg.transcript as string)?.trim();
        if (transcript) config.onAiTranscript(transcript);
        break;
      }

      // Handle both legacy and current event names for buffer stop.
      // The Realtime API has used both "output_audio_buffer.stopped" and
      // "output_audio_buffer.speech_stopped" across model versions.
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.speech_stopped": {
        const responseId = msg.response_id as string | undefined;
        if (responseId && responseId !== activeResponseIdRef.current) break;
        if (playbackSafetyTimerRef.current) {
          clearTimeout(playbackSafetyTimerRef.current);
          playbackSafetyTimerRef.current = null;
        }
        config.onAiPlaybackComplete();
        if (responseId === activeResponseIdRef.current) {
          activeResponseIdRef.current = null;
        }
        // AI finished speaking — re-enable mic after grace period
        ungateMic();
        break;
      }

      case "output_audio_buffer.cleared": {
        if (playbackSafetyTimerRef.current) {
          clearTimeout(playbackSafetyTimerRef.current);
          playbackSafetyTimerRef.current = null;
        }
        config.onAiPlaybackComplete();
        activeResponseIdRef.current = null;
        ungateMic();
        break;
      }

      case "response.done": {
        const response = msg.response as { id?: string; status?: string } | undefined;
        if (
          response?.status &&
          response.status !== "completed" &&
          (!response.id || response.id === activeResponseIdRef.current)
        ) {
          if (playbackSafetyTimerRef.current) {
            clearTimeout(playbackSafetyTimerRef.current);
            playbackSafetyTimerRef.current = null;
          }
          config.onAiPlaybackComplete();
          if (response.id === activeResponseIdRef.current) {
            activeResponseIdRef.current = null;
          }
          ungateMic();
        } else if (response?.status === "completed") {
          // Normal completion — audio may still be playing from the buffer.
          // Start a safety timer: if the buffer-stopped event doesn't arrive
          // within a reasonable window, force-clear the speaking state so
          // the trainee isn't left waiting in silence.
          if (playbackSafetyTimerRef.current) {
            clearTimeout(playbackSafetyTimerRef.current);
          }
          const completedResponseId = response.id;
          playbackSafetyTimerRef.current = setTimeout(() => {
            playbackSafetyTimerRef.current = null;
            // Only act if we're still waiting on this exact response.
            // If activeResponseIdRef was already cleared (by a buffer-stopped
            // event that arrived before response.done), skip — it's handled.
            if (activeResponseIdRef.current === completedResponseId) {
              console.warn("[Realtime] Safety timeout: buffer-stopped event not received after response.done");
              // Use the safety-timeout callback if provided.  This lets the
              // simulation page update the UI and ungate the mic (so a human
              // trainee can speak) without flipping aiSpeakingRef — which
              // would cause the bot-clinician flow to interrupt still-playing
              // patient audio.  The actual buffer-stopped event will set
              // aiSpeakingRef when playback truly ends.
              if (config.onAiPlaybackSafetyTimeout) {
                config.onAiPlaybackSafetyTimeout();
              } else {
                config.onAiPlaybackComplete();
                activeResponseIdRef.current = null;
              }
              ungateMic();
            }
          }, 2000);
        }
        break;
      }

      case "error": {
        const error = msg.error as { message?: string };
        const errorMsg = error?.message || "Realtime API error";
        // Suppress "active response in progress" — we cancel before creating,
        // but the cancel/create can still race occasionally. Not user-facing.
        if (errorMsg.includes("active response")) break;
        config.onError(errorMsg);
        break;
      }
    }
  }, [gateMic, ungateMic]);

  const connect = useCallback(async (config: RealtimeSessionConfig) => {
    if (pcRef.current || dcRef.current || audioElRef.current || localStreamRef.current) {
      teardownConnectionResources(
        pcRef.current,
        dcRef.current,
        audioElRef.current,
        localStreamRef.current
      );
      pcRef.current = null;
      dcRef.current = null;
      audioElRef.current = null;
      localStreamRef.current = null;
    }

    const attemptId = connectAttemptRef.current + 1;
    connectAttemptRef.current = attemptId;
    disconnectedRef.current = false;
    activeResponseIdRef.current = null;
    setConnectionStatus("connecting");

    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null;
    let audioEl: HTMLAudioElement | null = null;
    let stream: MediaStream | null = null;

    const isStale = () =>
      disconnectedRef.current || connectAttemptRef.current !== attemptId;

    const cleanupAttempt = () => {
      teardownConnectionResources(pc, dc, audioEl, stream);

      if (pcRef.current === pc) pcRef.current = null;
      if (dcRef.current === dc) dcRef.current = null;
      if (audioElRef.current === audioEl) audioElRef.current = null;
      if (localStreamRef.current === stream) localStreamRef.current = null;
    };

    try {
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: config.voice,
          instructions: config.instructions,
        }),
      });

      if (!tokenRes.ok) throw new Error("Failed to get session token");
      const sessionData = await tokenRes.json();
      const ephemeralKey = sessionData.client_secret?.value;
      const realtimeModel = sessionData.model as string | undefined;
      if (!ephemeralKey) throw new Error("No ephemeral key in response");
      if (!realtimeModel) throw new Error("No realtime model in response");
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      const nextPc = new RTCPeerConnection();
      pc = nextPc;
      pcRef.current = nextPc;

      const nextAudioEl = document.createElement("audio");
      nextAudioEl.autoplay = true;
      audioEl = nextAudioEl;
      audioElRef.current = nextAudioEl;

      nextPc.ontrack = (event) => {
        if (disconnectedRef.current) return;
        nextAudioEl.srcObject = event.streams[0];
      };

      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (isStale()) {
        stream = nextStream;
        cleanupAttempt();
        return;
      }
      stream = nextStream;
      localStreamRef.current = nextStream;
      nextStream.getTracks().forEach((track) => nextPc.addTrack(track, nextStream));

      const nextDc = nextPc.createDataChannel("oai-events");
      dc = nextDc;
      dcRef.current = nextDc;

      nextDc.onopen = () => {
        if (!isStale()) {
          setConnectionStatus("connected");
        }
      };

      nextDc.onmessage = (event) => {
        if (isStale()) return;
        try {
          const msg = JSON.parse(event.data);
          handleServerEvent(msg, config);
        } catch {
          // ignore
        }
      };

      nextDc.onerror = () => {
        if (!isStale()) {
          config.onError("Data channel error");
          setConnectionStatus("error");
        }
      };

      const offer = await nextPc.createOffer();
      if (isStale()) {
        cleanupAttempt();
        return;
      }
      await nextPc.setLocalDescription(offer);
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(realtimeModel)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) throw new Error("SDP exchange failed");
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      const answerSdp = await sdpRes.text();
      if (isStale()) {
        cleanupAttempt();
        return;
      }
      await nextPc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
      if (isStale()) {
        cleanupAttempt();
      }
    } catch (err) {
      cleanupAttempt();
      if (isStale()) return;
      console.error("Realtime connection error:", err);
      config.onError(err instanceof Error ? err.message : "Connection failed");
      setConnectionStatus("error");
    }
  }, [handleServerEvent, setConnectionStatus]);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    if (dcRef.current?.readyState === "open" && !disconnectedRef.current) {
      dcRef.current.send(JSON.stringify(event));
    }
  }, []);

  const updateSession = useCallback((instructions: string) => {
    sendEvent({
      type: "session.update",
      session: { instructions },
    });
  }, [sendEvent]);

  const setTurnDetection = useCallback((enabled: boolean) => {
    sendEvent({
      type: "session.update",
      session: {
        turn_detection: enabled ? { ...DEFAULT_TURN_DETECTION } : null,
      },
    });
  }, [sendEvent]);

  const cancelCurrentResponse = useCallback(() => {
    sendEvent({ type: "response.cancel" });
  }, [sendEvent]);

  // User-facing mute toggle (separate from echo gating)
  const setMicEnabled = useCallback((enabled: boolean) => {
    if (micGatedRef.current) return; // Don't override echo gate
    if (enabled && micForcedOffRef.current) return;
    setMicTrackEnabled(enabled);
  }, [setMicTrackEnabled]);

  const setMicForcedOff = useCallback((forcedOff: boolean) => {
    micForcedOffRef.current = forcedOff;

    if (unmutTimerRef.current) {
      clearTimeout(unmutTimerRef.current);
      unmutTimerRef.current = null;
    }

    if (forcedOff) {
      setMicTrackEnabled(false);
      return;
    }

    if (micGatedRef.current) return;

    const userMuted = useSimulationStore.getState().micMuted;
    setMicTrackEnabled(!userMuted);
  }, [setMicTrackEnabled]);

  const disconnect = useCallback(() => {
    connectAttemptRef.current += 1;
    disconnectedRef.current = true;

    if (unmutTimerRef.current) {
      clearTimeout(unmutTimerRef.current);
      unmutTimerRef.current = null;
    }
    if (playbackSafetyTimerRef.current) {
      clearTimeout(playbackSafetyTimerRef.current);
      playbackSafetyTimerRef.current = null;
    }

    teardownConnectionResources(
      pcRef.current,
      dcRef.current,
      audioElRef.current,
      localStreamRef.current
    );
    pcRef.current = null;
    dcRef.current = null;
    audioElRef.current = null;
    localStreamRef.current = null;

    activeResponseIdRef.current = null;
    micGatedRef.current = false;
    micForcedOffRef.current = false;
    lastTraineeTextRef.current = "";
    lastTraineeTimeRef.current = 0;
    setConnectionStatus("disconnected");
  }, [setConnectionStatus]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    sendEvent,
    updateSession,
    setTurnDetection,
    cancelCurrentResponse,
    setMicEnabled,
    setMicForcedOff,
    audioElRef,
    localStreamRef,
  };
}
