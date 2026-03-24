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
  const pendingSpeechRef = useRef<{
    resolve: (value: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
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

      if (!tokenRes.ok) throw new Error("Failed to get clinician realtime token");
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

          if (type === "response.done") {
            clearPendingSpeech(true);
            return;
          }

          if (type === "error") {
            const error = msg.error as { message?: string } | undefined;
            clearPendingSpeech(false);
            config.onError(error?.message || "Clinician realtime audio error");
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
      const timeout = setTimeout(() => {
        clearPendingSpeech(false);
      }, 15000);

      pendingSpeechRef.current = { resolve, timeout };

      if (instructions) {
        dc.send(JSON.stringify({
          type: "session.update",
          session: { instructions },
        }));
      }

      dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `<line>${text}</line>`,
            },
          ],
        },
      }));
      dc.send(JSON.stringify({ type: "response.create" }));
    });
  }, [clearPendingSpeech]);

  const disconnect = useCallback(() => {
    connectAttemptRef.current += 1;
    disconnectedRef.current = true;
    readyRef.current = false;
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
