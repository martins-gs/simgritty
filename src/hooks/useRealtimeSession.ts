"use client";

import { useRef, useCallback, useEffect } from "react";
import {
  countSdpCandidates,
  mergeIceCandidatesIntoSdp,
  resolveIceServers,
  selectBestLocalSdp,
  summarizeIceCandidate,
  summarizeSdpCandidates,
  type GatheredIceCandidate,
} from "@/lib/realtime/peerConnection";
import { useSimulationStore } from "@/store/simulationStore";

function getSupportedSegmentMimeType(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }

  return null;
}

export interface TraineeTranscriptMeta {
  itemId: string;
  audioStartMs: number | null;
  audioEndMs: number | null;
  durationMs: number | null;
}

export interface TraineeAudioSegment extends TraineeTranscriptMeta {
  blob: Blob;
  mimeType: string;
}

interface RealtimeSessionConfig {
  voice: string;
  instructions: string;
  onTraineeTranscript: (text: string, meta?: TraineeTranscriptMeta) => void;
  onTraineeAudioSegment?: (segment: TraineeAudioSegment) => void;
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

/** Max time (ms) to wait for the data channel to open before treating as a failure. */
const CONNECTION_TIMEOUT_MS = 20_000;
const LOCAL_ICE_GATHERING_TIMEOUT_MS = 3_000;

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
  const activeResponseTranscriptDoneRef = useRef(false);
  // Mic gating: mute mic while AI speaks to prevent echo feedback loop
  const micGatedRef = useRef(false);
  const micForcedOffRef = useRef(false);
  const unmutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Safety timer: force-clear speaking state if the buffer-stopped event
  // never arrives after the response completes.
  const playbackSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutivePlaybackSafetyTimeoutsRef = useRef(0);
  // Connection timeout: detect stuck "connecting" state
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Deduplication
  const lastTraineeTextRef = useRef("");
  const lastTraineeTimeRef = useRef(0);
  const lastTraineeItemIdRef = useRef("");
  const traineeSpeechBoundariesRef = useRef(new Map<string, {
    audioStartMs: number | null;
    audioEndMs: number | null;
  }>());
  const traineeSegmentRecorderRef = useRef<{
    itemId: string;
    recorder: MediaRecorder;
    chunks: Blob[];
    audioStartMs: number | null;
    audioEndMs: number | null;
    mimeType: string;
  } | null>(null);

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
      audioEl.removeAttribute("src");
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

  const resetTraineeSegmentRecorder = useCallback(() => {
    const segment = traineeSegmentRecorderRef.current;
    if (!segment) return;

    if (segment.recorder.state !== "inactive") {
      try {
        segment.recorder.stop();
      } catch {}
    }

    traineeSegmentRecorderRef.current = null;
  }, []);

  const startTraineeSegmentRecorder = useCallback((
    itemId: string,
    audioStartMs: number | null,
    config: RealtimeSessionConfig
  ) => {
    const stream = localStreamRef.current;
    const mimeType = getSupportedSegmentMimeType();
    if (!stream || typeof MediaRecorder === "undefined" || !mimeType) {
      return;
    }

    resetTraineeSegmentRecorder();

    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      const nextSegment = {
        itemId,
        recorder,
        chunks: [] as Blob[],
        audioStartMs,
        audioEndMs: null as number | null,
        mimeType,
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          nextSegment.chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const boundary = traineeSpeechBoundariesRef.current.get(itemId);
        const audioEndMs = nextSegment.audioEndMs ?? boundary?.audioEndMs ?? null;
        const blob = nextSegment.chunks.length > 0
          ? new Blob(nextSegment.chunks, { type: mimeType })
          : null;

        traineeSegmentRecorderRef.current = null;

        if (!blob || !config.onTraineeAudioSegment) {
          return;
        }

        config.onTraineeAudioSegment({
          itemId,
          blob,
          mimeType,
          audioStartMs,
          audioEndMs,
          durationMs:
            audioStartMs != null && audioEndMs != null
              ? Math.max(0, audioEndMs - audioStartMs)
              : null,
        });
      };

      recorder.start();
      traineeSegmentRecorderRef.current = nextSegment;
    } catch (error) {
      console.error("[Realtime] Failed to start trainee segment recorder", error);
    }
  }, [resetTraineeSegmentRecorder]);

  const stopTraineeSegmentRecorder = useCallback((itemId: string, audioEndMs: number | null) => {
    const segment = traineeSegmentRecorderRef.current;
    if (!segment || segment.itemId !== itemId) {
      return;
    }

    segment.audioEndMs = audioEndMs;
    if (segment.recorder.state !== "inactive") {
      segment.recorder.stop();
    }
  }, []);

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
          activeResponseTranscriptDoneRef.current = false;
          // AI is about to speak — mute the mic to prevent echo loop
          gateMic();
        }
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const transcript = (msg.transcript as string)?.trim();
        if (!transcript) break;
        const itemId = typeof msg.item_id === "string" ? msg.item_id : "";
        const boundaries = itemId ? traineeSpeechBoundariesRef.current.get(itemId) : undefined;

        // The mic track is disabled while the echo gate is active, so no new audio
        // reaches the API during gating. Any transcript arriving while gated is from
        // speech captured BEFORE the gate activated — it is real trainee speech, not echo.
        // We no longer drop these transcripts.

        // Drop non-English hallucinations
        if (!isLikelyEnglish(transcript)) break;

        // Deduplicate retransmissions of the same transcript item, but do not
        // collapse distinct utterances that happen to have the same words.
        const now = Date.now();
        if (itemId && itemId === lastTraineeItemIdRef.current) {
          break;
        }
        if (
          !itemId &&
          transcript === lastTraineeTextRef.current &&
          now - lastTraineeTimeRef.current < 3000
        ) {
          break;
        }
        lastTraineeItemIdRef.current = itemId;
        lastTraineeTextRef.current = transcript;
        lastTraineeTimeRef.current = now;

        config.onTraineeTranscript(transcript, itemId ? {
          itemId,
          audioStartMs: boundaries?.audioStartMs ?? null,
          audioEndMs: boundaries?.audioEndMs ?? null,
          durationMs:
            boundaries?.audioStartMs != null && boundaries?.audioEndMs != null
              ? Math.max(0, boundaries.audioEndMs - boundaries.audioStartMs)
              : null,
        } : undefined);
        break;
      }

      case "input_audio_buffer.speech_started": {
        const itemId = typeof msg.item_id === "string" ? msg.item_id : "";
        const audioStartMs = typeof msg.audio_start_ms === "number" ? msg.audio_start_ms : null;
        if (!itemId) break;

        traineeSpeechBoundariesRef.current.set(itemId, {
          audioStartMs,
          audioEndMs: null,
        });
        startTraineeSegmentRecorder(itemId, audioStartMs, config);
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        const itemId = typeof msg.item_id === "string" ? msg.item_id : "";
        const audioEndMs = typeof msg.audio_end_ms === "number" ? msg.audio_end_ms : null;
        if (!itemId) break;

        const existing = traineeSpeechBoundariesRef.current.get(itemId) ?? {
          audioStartMs: null,
          audioEndMs: null,
        };
        traineeSpeechBoundariesRef.current.set(itemId, {
          ...existing,
          audioEndMs,
        });
        stopTraineeSegmentRecorder(itemId, audioEndMs);
        break;
      }

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        const responseId = msg.response_id as string | undefined;
        if (responseId && responseId !== activeResponseIdRef.current) break;
        const delta = msg.delta as string;
        if (delta) config.onAiTranscriptDelta(delta);
        break;
      }

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const responseId = msg.response_id as string | undefined;
        if (responseId && responseId !== activeResponseIdRef.current) break;
        activeResponseTranscriptDoneRef.current = true;
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
        consecutivePlaybackSafetyTimeoutsRef.current = 0;
        config.onAiPlaybackComplete();
        if (responseId === activeResponseIdRef.current) {
          activeResponseIdRef.current = null;
          activeResponseTranscriptDoneRef.current = false;
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
        consecutivePlaybackSafetyTimeoutsRef.current = 0;
        config.onAiPlaybackComplete();
        activeResponseIdRef.current = null;
        activeResponseTranscriptDoneRef.current = false;
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
          consecutivePlaybackSafetyTimeoutsRef.current = 0;
          config.onAiPlaybackComplete();
          if (response.id === activeResponseIdRef.current) {
            activeResponseIdRef.current = null;
            activeResponseTranscriptDoneRef.current = false;
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
              const transcriptDone = activeResponseTranscriptDoneRef.current;
              const consecutiveMisses = consecutivePlaybackSafetyTimeoutsRef.current + 1;
              consecutivePlaybackSafetyTimeoutsRef.current = consecutiveMisses;
              const logMessage =
                `[Realtime] Safety timeout: buffer-stopped event not received after response.done ` +
                `(response_id=${completedResponseId ?? "unknown"}, ` +
                `transcript_done=${transcriptDone ? "yes" : "no"}, ` +
                `consecutive_misses=${consecutiveMisses})`;
              if (consecutiveMisses >= 2) {
                console.warn(logMessage);
              } else {
                console.info(logMessage);
              }
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
  }, [gateMic, startTraineeSegmentRecorder, stopTraineeSegmentRecorder, ungateMic]);

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
    activeResponseTranscriptDoneRef.current = false;
    consecutivePlaybackSafetyTimeoutsRef.current = 0;
    setConnectionStatus("connecting");

    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null;
    let audioEl: HTMLAudioElement | null = null;
    let stream: MediaStream | null = null;
    let localIceCandidateCount = 0;
    const emittedLocalIceCandidates: GatheredIceCandidate[] = [];

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
      console.info("[Realtime] Fetching session token…");
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: config.voice,
          instructions: config.instructions,
        }),
      });

      if (!tokenRes.ok) {
        const detail = await tokenRes.text().catch(() => "");
        throw new Error(`Failed to get session token (${tokenRes.status}): ${detail}`);
      }
      const sessionData = await tokenRes.json();
      const ephemeralKey = sessionData.client_secret?.value;
      const realtimeModel = sessionData.model as string | undefined;
      if (!ephemeralKey) throw new Error("No ephemeral key in response");
      if (!realtimeModel) throw new Error("No realtime model in response");

      console.info(
        `[Realtime] Session token OK — model=${realtimeModel}, ` +
        `ice_servers=${Array.isArray(sessionData.ice_servers) ? sessionData.ice_servers.length : "none"}`
      );
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      console.info("[Realtime] Requesting microphone…");
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.info("[Realtime] Microphone acquired");
      if (isStale()) {
        stream = nextStream;
        cleanupAttempt();
        return;
      }
      stream = nextStream;
      localStreamRef.current = nextStream;

      const { iceServers, source: iceServerSource } = resolveIceServers(sessionData.ice_servers);
      if (iceServerSource === "openai") {
        console.info(`[Realtime] Using OpenAI ICE servers (${iceServers.length})`);
      } else {
        console.info("[Realtime] No OpenAI ICE servers provided — using STUN fallback");
      }

      const nextPc = new RTCPeerConnection({ iceServers });
      pc = nextPc;
      pcRef.current = nextPc;

      const nextAudioEl = document.createElement("audio");
      nextAudioEl.autoplay = true;
      nextAudioEl.setAttribute("playsinline", "true");
      audioEl = nextAudioEl;
      audioElRef.current = nextAudioEl;

      nextPc.ontrack = (event) => {
        if (disconnectedRef.current) return;
        console.info("[Realtime] ontrack — remote audio stream received");
        nextAudioEl.srcObject = event.streams[0];
      };

      nextStream.getTracks().forEach((track) => nextPc.addTrack(track, nextStream));

      const nextDc = nextPc.createDataChannel("oai-events");
      dc = nextDc;
      dcRef.current = nextDc;

      nextDc.onopen = () => {
        if (!isStale()) {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          console.info("[Realtime] Data channel open — connected!");
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

      nextDc.onerror = (ev) => {
        if (!isStale()) {
          console.error("[Realtime] Data channel error", ev);
          config.onError("Data channel error");
          setConnectionStatus("error");
        }
      };

      // Monitor the peer connection for ICE/DTLS failures.
      nextPc.onconnectionstatechange = () => {
        const state = nextPc.connectionState;
        console.info(`[Realtime] connectionState → ${state}`);
        if (isStale()) return;
        if (state === "failed") {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          config.onError("Connection failed — check your network and try again");
          setConnectionStatus("error");
        } else if (state === "disconnected") {
          const currentStatus = useSimulationStore.getState().connectionStatus;
          if (currentStatus === "connected") {
            setConnectionStatus("reconnecting");
          }
        } else if (state === "connected") {
          const currentStatus = useSimulationStore.getState().connectionStatus;
          if (currentStatus === "reconnecting") {
            setConnectionStatus("connected");
          }
        }
      };

      nextPc.oniceconnectionstatechange = () => {
        console.info(`[Realtime] iceConnectionState → ${nextPc.iceConnectionState}`);
      };

      nextPc.onicegatheringstatechange = () => {
        console.info(`[Realtime] iceGatheringState → ${nextPc.iceGatheringState}`);
      };

      nextPc.onicecandidate = (event) => {
        if (event.candidate) {
          localIceCandidateCount += 1;
          emittedLocalIceCandidates.push({
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          });
        }
        console.info(`[Realtime] localIceCandidate → ${summarizeIceCandidate(event.candidate)}`);
      };

      nextPc.onicecandidateerror = (event) => {
        console.error(
          `[Realtime] iceCandidateError → address=${event.address || "unknown"} ` +
          `port=${event.port || "unknown"} url=${event.url || "unknown"} ` +
          `errorCode=${event.errorCode} errorText=${event.errorText}`
        );
      };

      // Safety timeout: if the data channel hasn't opened within
      // CONNECTION_TIMEOUT_MS, treat this as a failure.
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      connectionTimeoutRef.current = setTimeout(() => {
        connectionTimeoutRef.current = null;
        if (isStale()) return;
        const currentStatus = useSimulationStore.getState().connectionStatus;
        if (currentStatus === "connecting") {
          console.error(
            `[Realtime] Connection timeout after ${CONNECTION_TIMEOUT_MS}ms ` +
            `(iceConnectionState=${nextPc.iceConnectionState}, ` +
            `connectionState=${nextPc.connectionState}, ` +
            `iceGatheringState=${nextPc.iceGatheringState}, ` +
            `signalingState=${nextPc.signalingState})`
          );
          config.onError("Connection timed out — please check your network and try again");
          setConnectionStatus("error");
          cleanupAttempt();
        }
      }, CONNECTION_TIMEOUT_MS);

      const offer = await nextPc.createOffer();
      const offerSdp = offer.sdp;
      if (!offerSdp) {
        throw new Error("WebRTC offer did not contain SDP");
      }
      if (isStale()) {
        cleanupAttempt();
        return;
      }
      await nextPc.setLocalDescription(offer);
      if (countSdpCandidates(nextPc.localDescription?.sdp) === 0 && nextPc.iceGatheringState !== "complete") {
        console.info(
          `[Realtime] Waiting up to ${LOCAL_ICE_GATHERING_TIMEOUT_MS}ms for local ICE candidates…`
        );
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            nextPc.removeEventListener("icecandidate", handleCandidate);
            nextPc.removeEventListener("icegatheringstatechange", handleGatheringStateChange);
            clearTimeout(timeout);
            resolve();
          };
          const handleCandidate = (event: RTCPeerConnectionIceEvent) => {
            if (event.candidate) finish();
          };
          const handleGatheringStateChange = () => {
            if (nextPc.iceGatheringState === "complete") finish();
          };
          const timeout = setTimeout(finish, LOCAL_ICE_GATHERING_TIMEOUT_MS);
          nextPc.addEventListener("icecandidate", handleCandidate);
          nextPc.addEventListener("icegatheringstatechange", handleGatheringStateChange);
        });
      }
      const baseLocalSdp = selectBestLocalSdp(
        offerSdp,
        nextPc.pendingLocalDescription,
        nextPc.localDescription,
      );
      const localSdp = mergeIceCandidatesIntoSdp(baseLocalSdp, emittedLocalIceCandidates);
      const sdpSource =
        countSdpCandidates(baseLocalSdp) > 0
          ? "localDescription"
          : countSdpCandidates(localSdp) > 0
            ? "injectedCandidates"
            : "offer";
      console.info(
        `[Realtime] Local description set (${summarizeSdpCandidates(localSdp)}, ` +
        `emitted_candidates=${localIceCandidateCount}, ` +
        `sdp_source=${sdpSource})`
      );
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      // GA Realtime WebRTC now exchanges SDP via /v1/realtime/calls.
      console.info(`[Realtime] Sending SDP offer to OpenAI Calls API (model=${realtimeModel})…`);
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: localSdp,
        }
      );

      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => "");
        throw new Error(`SDP exchange failed (${sdpRes.status}): ${detail}`);
      }
      if (isStale()) {
        cleanupAttempt();
        return;
      }

      const answerSdp = await sdpRes.text();
      console.info(
        `[Realtime] SDP answer received (${answerSdp.length} bytes, ` +
        `starts_with_v=${answerSdp.startsWith("v=")}, ` +
        `${summarizeSdpCandidates(answerSdp)})`
      );

      if (!answerSdp.startsWith("v=")) {
        throw new Error(
          `SDP answer from OpenAI is not valid SDP (starts with: ${answerSdp.slice(0, 40)})`
        );
      }

      if (isStale()) {
        cleanupAttempt();
        return;
      }
      await nextPc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
      console.info("[Realtime] Remote description set — waiting for data channel to open…");
      if (isStale()) {
        cleanupAttempt();
      }
    } catch (err) {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
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
      session: {
        type: "realtime",
        instructions,
      },
    });
  }, [sendEvent]);

  const setTurnDetection = useCallback((enabled: boolean) => {
    sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        audio: {
          input: {
            turn_detection: enabled ? { ...DEFAULT_TURN_DETECTION } : null,
          },
        },
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

    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
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
    resetTraineeSegmentRecorder();
    pcRef.current = null;
    dcRef.current = null;
    audioElRef.current = null;
    localStreamRef.current = null;

    activeResponseIdRef.current = null;
    activeResponseTranscriptDoneRef.current = false;
    consecutivePlaybackSafetyTimeoutsRef.current = 0;
    micGatedRef.current = false;
    micForcedOffRef.current = false;
    lastTraineeTextRef.current = "";
    lastTraineeTimeRef.current = 0;
    lastTraineeItemIdRef.current = "";
    traineeSpeechBoundariesRef.current.clear();
    setConnectionStatus("disconnected");
  }, [resetTraineeSegmentRecorder, setConnectionStatus]);

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
