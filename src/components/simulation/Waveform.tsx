"use client";

import { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface WaveformProps {
  audioEl: HTMLAudioElement | null;
  isActive: boolean;
  escalationLevel: number;
  className?: string;
}

function getBarColor(level: number): string {
  if (level <= 2) return "#10b981"; // emerald-500
  if (level <= 4) return "#f59e0b"; // amber-500
  if (level <= 6) return "#f97316"; // orange-500
  if (level <= 8) return "#ef4444"; // red-500
  return "#b91c1c"; // red-700
}

export function Waveform({ audioEl, isActive, escalationLevel, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const connectedElRef = useRef<HTMLAudioElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, w, h);

    const barCount = 48;
    const gap = 3;
    const barWidth = (w - (barCount - 1) * gap) / barCount;
    const color = getBarColor(escalationLevel);
    const midY = h / 2;

    for (let i = 0; i < barCount; i++) {
      // Sample from frequency data — spread across the range
      const dataIndex = Math.floor((i / barCount) * bufferLength * 0.6);
      const value = dataArray[dataIndex] / 255;

      // Minimum bar height for idle state
      const minH = 2;
      const barH = Math.max(minH, value * midY * 0.85);

      const x = i * (barWidth + gap);

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.15 + value * 0.85;

      // Draw mirrored bars from centre
      const radius = Math.min(barWidth / 2, 3);
      roundRect(ctx, x, midY - barH, barWidth, barH, radius);
      roundRect(ctx, x, midY, barWidth, barH, radius);
    }

    ctx.globalAlpha = 1;
    rafRef.current = requestAnimationFrame(draw);
  }, [escalationLevel]);

  useEffect(() => {
    // Connect analyser to the audio element when it changes
    if (!audioEl || audioEl === connectedElRef.current) return;

    // Create or reuse AudioContext
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const audioCtx = audioCtxRef.current;

    // Create source from the audio element
    try {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      const source = audioCtx.createMediaElementSource(audioEl);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;

      source.connect(analyser);
      analyser.connect(audioCtx.destination); // pass audio through so it still plays

      sourceRef.current = source;
      analyserRef.current = analyser;
      connectedElRef.current = audioEl;
    } catch {
      // May fail if source was already created for this element
    }
  }, [audioEl]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("w-full", className)}
      style={{ height: 120 }}
    />
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}
