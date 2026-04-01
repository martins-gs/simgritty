"use client";

import { useEffect, useRef, useState } from "react";

const phrases = [
  { text: "difficult relatives", color: "#ef4444" },
  { text: "distressed patients", color: "#f97316" },
  { text: "staff conflict", color: "#e11d48" },
  { text: "microaggressions", color: "#7c3aed" },
  { text: "difficult conversations", color: "#2563eb" },
  { text: "speaking up", color: "#0891b2" },
  { text: "challenging bias", color: "#9333ea" },
  { text: "de-escalation", color: "#059669" },
  { text: "repair after harm", color: "#d97706" },
];

export function HeroTextRotator() {
  const [index, setIndex] = useState(0);
  const [rolling, setRolling] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  const current = phrases[index];
  const next = phrases[(index + 1) % phrases.length];

  useEffect(() => {
    const interval = setInterval(() => {
      setRolling(true);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  function handleTransitionEnd() {
    if (!rolling) return;
    setIndex((prev) => (prev + 1) % phrases.length);
    setRolling(false);
  }

  return (
    <>
      <style>{`
        .hero-rotator {
          display: inline-block;
          overflow: hidden;
          vertical-align: bottom;
          height: 1.15em;
          position: relative;
        }
        .hero-rotator-strip {
          display: flex;
          flex-direction: column;
        }
        .hero-rotator-strip.rolling {
          animation: hero-spring 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes hero-spring {
          0%   { transform: translateY(0); }
          50%  { transform: translateY(-54%); }
          72%  { transform: translateY(-48.5%); }
          88%  { transform: translateY(-50.8%); }
          100% { transform: translateY(-50%); }
        }
        .hero-rotator-item {
          height: 1.15em;
          line-height: 1.15em;
          white-space: nowrap;
        }
      `}</style>
      <span className="hero-rotator" ref={containerRef}>
        <span
          className={`hero-rotator-strip${rolling ? " rolling" : ""}`}
          onAnimationEnd={handleTransitionEnd}
        >
          <span className="hero-rotator-item font-bold" style={{ color: current.color }}>
            {current.text}
          </span>
          <span className="hero-rotator-item font-bold" style={{ color: next.color }}>
            {next.text}
          </span>
        </span>
      </span>
    </>
  );
}
