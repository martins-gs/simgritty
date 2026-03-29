"use client";

import { useRef, useCallback } from "react";

function getSupportedMimeType(): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function useSessionRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mimeTypeRef = useRef<string | null>(null);
  const startedAtRef = useRef<string | null>(null);

  const start = useCallback(
    (localStream: MediaStream, remoteStream: MediaStream | null) => {
      if (typeof MediaRecorder === "undefined") {
        console.warn("[SessionRecorder] MediaRecorder not available");
        return;
      }

      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        console.warn("[SessionRecorder] No supported audio MIME type found");
        return;
      }
      mimeTypeRef.current = mimeType;

      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;

        const dest = ctx.createMediaStreamDestination();
        destNodeRef.current = dest;

        const localSource = ctx.createMediaStreamSource(localStream);
        localSource.connect(dest);

        if (remoteStream && remoteStream.getAudioTracks().length > 0) {
          const remoteSource = ctx.createMediaStreamSource(remoteStream);
          remoteSource.connect(dest);
        }

        const recorder = new MediaRecorder(dest.stream, { mimeType });
        chunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onerror = (e) => {
          console.error("[SessionRecorder] MediaRecorder error", e);
        };

        recorder.start(1000);
        recorderRef.current = recorder;
        startedAtRef.current = new Date().toISOString();
      } catch (err) {
        console.error("[SessionRecorder] Failed to start recording", err);
      }
    },
    []
  );

  /**
   * Attach a remote stream that arrived after recording started.
   * Connects it to the same AudioContext destination node so the
   * mixed recording picks it up.
   */
  const addRemoteStream = useCallback((remoteStream: MediaStream) => {
    const ctx = audioCtxRef.current;
    const dest = destNodeRef.current;
    if (!ctx || !dest || !recorderRef.current) return;

    try {
      const remoteSource = ctx.createMediaStreamSource(remoteStream);
      remoteSource.connect(dest);
    } catch (err) {
      console.error("[SessionRecorder] Failed to add remote stream", err);
    }
  }, []);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      recorderRef.current = null;
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const mimeType = mimeTypeRef.current || "audio/webm";
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: mimeType })
            : null;
        chunksRef.current = [];
        recorderRef.current = null;
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const dispose = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    chunksRef.current = [];
    destNodeRef.current = null;

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
  }, []);

  const getStartedAt = useCallback(() => startedAtRef.current, []);

  return { start, addRemoteStream, stop, dispose, getStartedAt };
}
