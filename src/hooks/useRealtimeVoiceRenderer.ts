"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  normalizeIceServers,
  summarizeIceCandidate,
  summarizeSdpCandidates,
} from "@/lib/realtime/peerConnection";

interface RealtimeVoiceRendererConfig {
  voice: string;
  instructions: string;
  onError: (error: string) => void;
}

interface SpeakOptions {
  text: string;
  instructions?: string;
}

type RealtimeSpeakResult = "completed" | "partial" | "failed";

/** Max time (ms) to wait for the data channel to open before treating as a failure. */
const CONNECTION_TIMEOUT_MS = 20_000;

const MIN_SPEECH_TIMEOUT_MS = 15000;
const MAX_SPEECH_TIMEOUT_MS = 30000;
const SPEECH_TIMEOUT_BASE_MS = 5000;
const SPEECH_TIMEOUT_PER_WORD_MS = 500;

function estimateSpeechTimeoutMs(text: string) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(
    MIN_SPEECH_TIMEOUT_MS,
    Math.min(MAX_SPEECH_TIMEOUT_MS, SPEECH_TIMEOUT_BASE_MS + wordCount * SPEECH_TIMEOUT_PER_WORD_MS)
  );
}

function teardownRendererResources(
  pc: RTCPeerConnection | null,
  dc: RTCDataChannel | null,
  audioEl: HTMLAudioElement | null
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
      pc.getReceivers().forEach((receiver) => {
        if (receiver.track) receiver.track.stop();
      });
      pc.close();
    } catch {}
  }
}

export function useRealtimeVoiceRenderer() {
  const RESPONSE_DONE_NO_AUDIO_GRACE_MS = 1200;
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const connectAttemptRef = useRef(0);
  const disconnectedRef = useRef(false);
  const readyRef = useRef(false);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeResponseIdRef = useRef<string | null>(null);
  const pendingSpeechRef = useRef<{
    responseId: string | null;
    resolve: (value: RealtimeSpeakResult) => void;
    timeout: ReturnType<typeof setTimeout>;
    completionTimer: ReturnType<typeof setTimeout> | null;
    startedAt: number;
    sawAudioStarted: boolean;
    sawAudioCompletion: boolean;
  } | null>(null);

  const clearPendingSpeech = useCallback((value: RealtimeSpeakResult) => {
    if (!pendingSpeechRef.current) return;
    clearTimeout(pendingSpeechRef.current.timeout);
    if (pendingSpeechRef.current.completionTimer) {
      clearTimeout(pendingSpeechRef.current.completionTimer);
    }
    pendingSpeechRef.current.resolve(value);
    pendingSpeechRef.current = null;
  }, []);

  const failPendingSpeech = useCallback((
    reason: string,
    onFailure?: (outcome: RealtimeSpeakResult) => void
  ) => {
    const pendingSpeech = pendingSpeechRef.current;
    if (!pendingSpeech) return;

    const outcome: RealtimeSpeakResult = pendingSpeech.sawAudioStarted ? "partial" : "failed";
    const elapsedMs = Math.round(performance.now() - pendingSpeech.startedAt);
    console.warn(
      `[Clinician Audio] path=realtime outcome=${outcome} reason=${reason} elapsed_ms=${elapsedMs}`
    );
    clearPendingSpeech(outcome);
    onFailure?.(outcome);
  }, [clearPendingSpeech]);

  const connect = useCallback(async (config: RealtimeVoiceRendererConfig) => {
    if (pcRef.current || dcRef.current || audioElRef.current) {
      teardownRendererResources(pcRef.current, dcRef.current, audioElRef.current);
      pcRef.current = null;
      dcRef.current = null;
      audioElRef.current = null;
    }

    const attemptId = connectAttemptRef.current + 1;
    connectAttemptRef.current = attemptId;
    disconnectedRef.current = false;
    readyRef.current = false;
    activeResponseIdRef.current = null;

    let pc: RTCPeerConnection | null = null;
    let dc: RTCDataChannel | null = null;
    let audioEl: HTMLAudioElement | null = null;

    const isStale = () =>
      disconnectedRef.current || connectAttemptRef.current !== attemptId;

    const cleanupAttempt = () => {
      teardownRendererResources(pc, dc, audioEl);
      if (pcRef.current === pc) pcRef.current = null;
      if (dcRef.current === dc) dcRef.current = null;
      if (audioElRef.current === audioEl) audioElRef.current = null;
      readyRef.current = false;
      activeResponseIdRef.current = null;
    };

    try {
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: config.voice,
          instructions: config.instructions,
          outputOnly: true,
        }),
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text().catch(() => "");
        throw new Error(
          errorText
            ? `Failed to get clinician realtime token: ${errorText}`
            : "Failed to get clinician realtime token"
        );
      }
      const sessionData = await tokenRes.json();
      const ephemeralKey = sessionData.client_secret?.value;
      const realtimeModel = sessionData.model as string | undefined;
      if (!ephemeralKey || !realtimeModel) throw new Error("Invalid clinician realtime session");
      console.info(
        `[Clinician Audio] Session token OK — model=${realtimeModel}, ` +
        `ice_servers=${Array.isArray(sessionData.ice_servers) ? sessionData.ice_servers.length : "none"}`
      );
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      const iceServers = normalizeIceServers(sessionData.ice_servers);
      if (iceServers) {
        console.info(`[Clinician Audio] Using OpenAI ICE servers (${iceServers.length})`);
      } else {
        console.info("[Clinician Audio] No OpenAI ICE servers provided — using browser default ICE config");
      }

      const nextPc = iceServers
        ? new RTCPeerConnection({ iceServers })
        : new RTCPeerConnection();
      pc = nextPc;
      pcRef.current = nextPc;
      nextPc.addTransceiver("audio", { direction: "recvonly" });

      const nextAudioEl = document.createElement("audio");
      nextAudioEl.autoplay = true;
      nextAudioEl.setAttribute("playsinline", "true");
      audioEl = nextAudioEl;
      audioElRef.current = nextAudioEl;

      nextPc.ontrack = (event) => {
        if (disconnectedRef.current) return;
        nextAudioEl.srcObject = event.streams[0];
        const markAudioStarted = () => {
          if (pendingSpeechRef.current) {
            pendingSpeechRef.current.sawAudioStarted = true;
          }
        };
        nextAudioEl.onplay = markAudioStarted;
        nextAudioEl.onplaying = markAudioStarted;
      };

      const nextDc = nextPc.createDataChannel("oai-events");
      dc = nextDc;
      dcRef.current = nextDc;

      nextDc.onopen = () => {
        if (!isStale()) {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          readyRef.current = true;
        }
      };

      nextDc.onmessage = (event) => {
        if (isStale()) return;
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          const type = msg.type as string | undefined;

          if (type === "response.created") {
            const response = msg.response as { id?: string } | undefined;
            if (response?.id) {
              activeResponseIdRef.current = response.id;
              const elapsedMs = pendingSpeechRef.current
                ? Math.round(performance.now() - pendingSpeechRef.current.startedAt)
                : null;
              console.info(
                `[Clinician Audio] path=realtime event=response.created response_id=${response.id} elapsed_ms=${elapsedMs ?? "unknown"}`
              );
              if (pendingSpeechRef.current && !pendingSpeechRef.current.responseId) {
                pendingSpeechRef.current.responseId = response.id;
              }
            }
            return;
          }

          if (type === "output_audio_buffer.started") {
            const responseId = msg.response_id as string | undefined;
            const pendingResponseId = pendingSpeechRef.current?.responseId;
            const elapsedMs = pendingSpeechRef.current
              ? Math.round(performance.now() - pendingSpeechRef.current.startedAt)
              : null;
            if (pendingSpeechRef.current) {
              pendingSpeechRef.current.sawAudioStarted = true;
            }
            if (!pendingResponseId || !responseId || responseId === pendingResponseId) {
              console.info(
                `[Clinician Audio] path=realtime event=output_audio_buffer.started response_id=${responseId || "unknown"} elapsed_ms=${elapsedMs ?? "unknown"}`
              );
            }
            return;
          }

          if (type === "output_audio_buffer.stopped") {
            const responseId = msg.response_id as string | undefined;
            const pendingResponseId = pendingSpeechRef.current?.responseId;
            const elapsedMs = pendingSpeechRef.current
              ? Math.round(performance.now() - pendingSpeechRef.current.startedAt)
              : null;
            console.info(
              `[Clinician Audio] path=realtime event=output_audio_buffer.stopped response_id=${responseId || "unknown"} elapsed_ms=${elapsedMs ?? "unknown"}`
            );
            if (!pendingResponseId || !responseId || responseId === pendingResponseId) {
              clearPendingSpeech("completed");
            }
            return;
          }

          if (type === "response.output_audio.done") {
            const responseId = msg.response_id as string | undefined;
            const pendingResponseId = pendingSpeechRef.current?.responseId;
            const elapsedMs = pendingSpeechRef.current
              ? Math.round(performance.now() - pendingSpeechRef.current.startedAt)
              : null;
            if (pendingSpeechRef.current) {
              pendingSpeechRef.current.sawAudioCompletion = true;
            }
            console.info(
              `[Clinician Audio] path=realtime event=response.output_audio.done response_id=${responseId || "unknown"} elapsed_ms=${elapsedMs ?? "unknown"}`
            );
            if (pendingSpeechRef.current && !pendingSpeechRef.current.responseId && responseId) {
              pendingSpeechRef.current.responseId = responseId;
            }
            if (pendingResponseId && responseId && responseId !== pendingResponseId) {
              return;
            }
            return;
          }

          if (type === "error") {
            const error = msg.error as { message?: string } | undefined;
            const message = error?.message || "Clinician realtime audio error";
            failPendingSpeech(`error:${message}`, () => config.onError(message));
            return;
          }

          if (type === "output_audio_buffer.cleared") {
            failPendingSpeech("output_audio_buffer.cleared", () => {
              config.onError("Clinician realtime output audio buffer cleared");
            });
            return;
          }

          if (type === "response.done") {
            const response = msg.response as { id?: string; status?: string } | undefined;
            if (response?.id || response?.status) {
              console.info(`[Clinician Audio] path=realtime event=response.done response_id=${response?.id || "unknown"} status=${response?.status || "unknown"}`);
            }
            const pendingResponseId = pendingSpeechRef.current?.responseId;
            if (pendingSpeechRef.current && !pendingSpeechRef.current.responseId && response?.id) {
              pendingSpeechRef.current.responseId = response.id;
            }
            if (response?.id && response.id === activeResponseIdRef.current) {
              activeResponseIdRef.current = null;
            }

            if (pendingResponseId && response?.id && response.id !== pendingResponseId) {
              return;
            }

            if (response?.status === "completed") {
              const pendingSpeech = pendingSpeechRef.current;
              if (!pendingSpeech) return;
              if (pendingSpeech.sawAudioStarted) {
                console.info(
                  `[Clinician Audio] path=realtime event=response.done waiting_for=output_audio_buffer.stopped response_id=${response?.id || "unknown"}`
                );
                return;
              }
              const fallbackMs = RESPONSE_DONE_NO_AUDIO_GRACE_MS;
              if (pendingSpeech.completionTimer) {
                clearTimeout(pendingSpeech.completionTimer);
              }
              pendingSpeech.completionTimer = setTimeout(() => {
                if (
                  pendingSpeechRef.current &&
                  (!pendingSpeechRef.current.responseId || pendingSpeechRef.current.responseId === response?.id)
                ) {
                  failPendingSpeech(`response.done:no_audio delay_ms=${fallbackMs}`, () => {
                    config.onError("Clinician realtime response completed without audio");
                  });
                }
              }, fallbackMs);
              return;
            }

            if (response?.status && response.status !== "completed") {
              failPendingSpeech(`response.done:${response.status}`, () => {
                config.onError(`Clinician realtime response ended with status ${response.status}`);
              });
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      nextDc.onerror = () => {
        if (!isStale()) {
          failPendingSpeech("data_channel_error", () => {
            config.onError("Clinician realtime data channel error");
          });
        }
      };

      // Monitor the peer connection for ICE/DTLS failures.
      nextPc.onconnectionstatechange = () => {
        const state = nextPc.connectionState;
        console.info(`[Clinician Audio] connectionState → ${state}`);
        if (isStale()) return;
        if (state === "failed") {
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          readyRef.current = false;
          failPendingSpeech("peer_connection_failed", () => {
            config.onError("Clinician voice connection failed — check your network");
          });
        }
      };

      nextPc.oniceconnectionstatechange = () => {
        console.info(`[Clinician Audio] iceConnectionState → ${nextPc.iceConnectionState}`);
      };

      nextPc.onicecandidate = (event) => {
        console.info(`[Clinician Audio] localIceCandidate → ${summarizeIceCandidate(event.candidate)}`);
      };

      nextPc.onicecandidateerror = (event) => {
        console.error(
          `[Clinician Audio] iceCandidateError → address=${event.address || "unknown"} ` +
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
        if (!readyRef.current) {
          console.error(
            `[Clinician Audio] Connection timeout: data channel did not open within ${CONNECTION_TIMEOUT_MS}ms`
          );
          config.onError("Clinician voice connection timed out");
          cleanupAttempt();
        }
      }, CONNECTION_TIMEOUT_MS);

      const offer = await nextPc.createOffer();
      if (isStale()) {
        cleanupAttempt();
        return false;
      }
      await nextPc.setLocalDescription(offer);
      console.info(
        `[Clinician Audio] Local description set (${summarizeSdpCandidates(nextPc.localDescription?.sdp ?? offer.sdp)})`
      );
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      console.info(`[Clinician Audio] Sending SDP offer to OpenAI Calls API (model=${realtimeModel})…`);
      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        const detail = await sdpRes.text().catch(() => "");
        throw new Error(`Clinician SDP exchange failed (${sdpRes.status}): ${detail}`);
      }
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      const answerSdp = await sdpRes.text();
      console.info(
        `[Clinician Audio] SDP answer received (${answerSdp.length} bytes, ` +
        `starts_with_v=${answerSdp.startsWith("v=")}, ` +
        `${summarizeSdpCandidates(answerSdp)})`
      );
      if (!answerSdp.startsWith("v=")) {
        throw new Error(
          `Clinician SDP answer is not valid SDP (starts with: ${answerSdp.slice(0, 40)})`
        );
      }
      if (isStale()) {
        cleanupAttempt();
        return false;
      }
      await nextPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      console.info("[Clinician Audio] Remote description set");
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      return true;
    } catch (err) {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
      cleanupAttempt();
      if (isStale()) return false;
      config.onError(err instanceof Error ? err.message : "Clinician realtime connection failed");
      return false;
    }
  }, [clearPendingSpeech, failPendingSpeech]);

  const speakText = useCallback(async ({ text, instructions }: SpeakOptions) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open" || !readyRef.current || disconnectedRef.current) {
      return "failed";
    }

    if (pendingSpeechRef.current) {
      clearPendingSpeech("failed");
    }

    return new Promise<RealtimeSpeakResult>((resolve) => {
      const startedAt = performance.now();
      const timeoutMs = estimateSpeechTimeoutMs(text);
      const timeout = setTimeout(() => {
        failPendingSpeech("timeout");
      }, timeoutMs);

      pendingSpeechRef.current = {
        responseId: null,
        resolve,
        timeout,
        completionTimer: null,
        startedAt,
        sawAudioStarted: false,
        sawAudioCompletion: false,
      };
      activeResponseIdRef.current = null;
      console.info(`[Clinician Audio] path=realtime request=response.create timeout_ms=${timeoutMs}`);

      dc.send(JSON.stringify({
        type: "response.create",
        response: {
          conversation: "none",
          instructions,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `<line>${text}</line>`,
                },
              ],
            },
          ],
        },
      }));
    });
  }, [clearPendingSpeech, failPendingSpeech]);

  const disconnect = useCallback(() => {
    connectAttemptRef.current += 1;
    disconnectedRef.current = true;
    readyRef.current = false;
    activeResponseIdRef.current = null;
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    clearPendingSpeech("failed");
    teardownRendererResources(pcRef.current, dcRef.current, audioElRef.current);
    pcRef.current = null;
    dcRef.current = null;
    audioElRef.current = null;
  }, [clearPendingSpeech]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    speakText,
  };
}
