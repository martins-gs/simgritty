"use client";

import { useCallback, useEffect, useRef } from "react";

interface RealtimeVoiceRendererConfig {
  voice: string;
  instructions: string;
  onError: (error: string) => void;
}

interface SpeakOptions {
  text: string;
  instructions?: string;
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
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const connectAttemptRef = useRef(0);
  const disconnectedRef = useRef(false);
  const readyRef = useRef(false);
  const activeResponseIdRef = useRef<string | null>(null);
  const pendingSpeechRef = useRef<{
    responseId: string | null;
    resolve: (value: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
    startedAt: number;
  } | null>(null);

  const clearPendingSpeech = useCallback((value: boolean) => {
    if (!pendingSpeechRef.current) return;
    clearTimeout(pendingSpeechRef.current.timeout);
    pendingSpeechRef.current.resolve(value);
    pendingSpeechRef.current = null;
  }, []);

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
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      const nextPc = new RTCPeerConnection();
      pc = nextPc;
      pcRef.current = nextPc;
      nextPc.addTransceiver("audio", { direction: "recvonly" });

      const nextAudioEl = document.createElement("audio");
      nextAudioEl.autoplay = true;
      audioEl = nextAudioEl;
      audioElRef.current = nextAudioEl;

      nextPc.ontrack = (event) => {
        if (disconnectedRef.current) return;
        nextAudioEl.srcObject = event.streams[0];
      };

      const nextDc = nextPc.createDataChannel("oai-events");
      dc = nextDc;
      dcRef.current = nextDc;

      nextDc.onopen = () => {
        if (!isStale()) {
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
              clearPendingSpeech(true);
            }
            return;
          }

          if (type === "error") {
            const error = msg.error as { message?: string } | undefined;
            clearPendingSpeech(false);
            config.onError(error?.message || "Clinician realtime audio error");
            return;
          }

          if (type === "output_audio_buffer.cleared") {
            clearPendingSpeech(false);
            return;
          }

          if (type === "response.done") {
            const response = msg.response as { id?: string; status?: string } | undefined;
            if (response?.id || response?.status) {
              console.info(`[Clinician Audio] path=realtime event=response.done response_id=${response?.id || "unknown"} status=${response?.status || "unknown"}`);
            }
            if (response?.id && response.id === activeResponseIdRef.current) {
              activeResponseIdRef.current = null;
            }
            if (
              response?.status &&
              response.status !== "completed" &&
              (!pendingSpeechRef.current?.responseId || pendingSpeechRef.current.responseId === response.id)
            ) {
              clearPendingSpeech(false);
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      nextDc.onerror = () => {
        if (!isStale()) {
          clearPendingSpeech(false);
          config.onError("Clinician realtime data channel error");
        }
      };

      const offer = await nextPc.createOffer();
      if (isStale()) {
        cleanupAttempt();
        return false;
      }
      await nextPc.setLocalDescription(offer);
      if (isStale()) {
        cleanupAttempt();
        return false;
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

      if (!sdpRes.ok) throw new Error("Clinician realtime SDP exchange failed");
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      const answerSdp = await sdpRes.text();
      if (isStale()) {
        cleanupAttempt();
        return false;
      }
      await nextPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      if (isStale()) {
        cleanupAttempt();
        return false;
      }

      return true;
    } catch (err) {
      cleanupAttempt();
      if (isStale()) return false;
      config.onError(err instanceof Error ? err.message : "Clinician realtime connection failed");
      return false;
    }
  }, [clearPendingSpeech]);

  const speakText = useCallback(async ({ text, instructions }: SpeakOptions) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open" || !readyRef.current || disconnectedRef.current) {
      return false;
    }

    if (pendingSpeechRef.current) {
      clearPendingSpeech(false);
    }

    return new Promise<boolean>((resolve) => {
      const startedAt = performance.now();
      const timeout = setTimeout(() => {
        clearPendingSpeech(false);
      }, 15000);

      pendingSpeechRef.current = { responseId: null, resolve, timeout, startedAt };
      activeResponseIdRef.current = null;
      console.info("[Clinician Audio] path=realtime request=response.create");

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
  }, [clearPendingSpeech]);

  const disconnect = useCallback(() => {
    connectAttemptRef.current += 1;
    disconnectedRef.current = true;
    readyRef.current = false;
    activeResponseIdRef.current = null;
    clearPendingSpeech(false);
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
