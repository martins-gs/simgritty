"use client";

import { useEffect, useRef, useState } from "react";

/* ── Layout ────────────────────────────────────────────── */

const R = 38; // node circle radius

/* ── Node definitions ──────────────────────────────────── */

interface NodeDef {
  id: string;
  label: string;
  sub: string;
  cx: number;
  cy: number;
  color: string;
  icon: string[];
}

const NODES: NodeDef[] = [
  {
    id: "educator",
    label: "Educator",
    sub: "Designs & reviews",
    cx: 300,
    cy: 65,
    color: "#3b82f6",
    icon: [
      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",
      "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
    ],
  },
  {
    id: "governance",
    label: "Governance",
    sub: "Org guardrails",
    cx: 72,
    cy: 200,
    color: "#0d9488",
    icon: [
      "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
      "M9 12l2 2 4-4",
    ],
  },
  {
    id: "assessment",
    label: "Assessment",
    sub: "Scores & classifies",
    cx: 528,
    cy: 200,
    color: "#8b5cf6",
    icon: ["M12 20V10", "M18 20V4", "M6 20v-4"],
  },
  {
    id: "trainee",
    label: "Trainee",
    sub: "Speaks & de-escalates",
    cx: 145,
    cy: 360,
    color: "#10b981",
    icon: [
      "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",
      "M19 10v2a7 7 0 0 1-14 0v-2",
      "M12 19v3",
    ],
  },
  {
    id: "ai",
    label: "AI Character",
    sub: "Responds in-role",
    cx: 455,
    cy: 360,
    color: "#f59e0b",
    icon: [
      "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
    ],
  },
];

/* ── Connection definitions ────────────────────────────── */

interface ConnDef {
  from: string;
  to: string;
  label: string;
  color: string;
  cp: [number, number];
  bidir?: boolean;
  /** [dx, dy] offset for the flow label from the curve midpoint. */
  labelOff?: [number, number];
}

/* Ordered to interleave governance into the narrative highlight cycle */
const CONNS: ConnDef[] = [
  { from: "educator", to: "ai", label: "Scenario design", color: "#3b82f6", cp: [480, 180] },
  { from: "governance", to: "educator", label: "Content policies", color: "#0d9488", cp: [135, 80] },
  { from: "trainee", to: "ai", label: "Live conversation", color: "#10b981", cp: [300, 405], bidir: true },
  { from: "governance", to: "ai", label: "Escalation ceiling", color: "#0d9488", cp: [200, 350] },
  { from: "ai", to: "assessment", label: "Classification", color: "#f59e0b", cp: [545, 285], labelOff: [-15, 18] },
  { from: "assessment", to: "trainee", label: "Feedback & scores", color: "#8b5cf6", cp: [340, 345] },
  { from: "assessment", to: "educator", label: "Analytics", color: "#8b5cf6", cp: [440, 95] },
];

/* ── Geometry helpers ──────────────────────────────────── */

function nodeById(id: string) {
  return NODES.find((n) => n.id === id)!;
}

/** Point on circle perimeter facing (tx, ty). */
function perim(cx: number, cy: number, tx: number, ty: number, r: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  const d = Math.hypot(dx, dy);
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
}

/** Midpoint of quadratic Bezier at t = 0.5. */
function qMid(x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number) {
  return {
    x: 0.25 * x0 + 0.5 * cpx + 0.25 * x1,
    y: 0.25 * y0 + 0.5 * cpy + 0.25 * y1,
  };
}

function buildConn(c: ConnDef) {
  const f = nodeById(c.from);
  const t = nodeById(c.to);
  const gap = R + 6;
  const s = perim(f.cx, f.cy, t.cx, t.cy, gap);
  const e = perim(t.cx, t.cy, f.cx, f.cy, gap);
  const d = `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${c.cp[0]},${c.cp[1]} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
  const mid = qMid(s.x, s.y, c.cp[0], c.cp[1], e.x, e.y);
  return { d, mid };
}

/* Pre-compute (static data) */
const connGeo = CONNS.map(buildConn);
const uniqueColors = [...new Set(CONNS.map((c) => c.color))];

/* ── CSS ───────────────────────────────────────────────── */

const STYLES = `
  .eco-node {
    opacity: 0;
    transform-origin: var(--ox) var(--oy);
    transform: scale(0.6);
  }
  .eco-entered .eco-node {
    animation: eco-in 600ms cubic-bezier(0.25, 1, 0.5, 1) var(--d) forwards;
  }
  @keyframes eco-in {
    to { opacity: 1; transform: scale(1); }
  }

  .eco-conn {
    opacity: 0;
  }
  .eco-entered .eco-conn {
    animation: eco-fade 500ms ease-out var(--d) forwards;
  }
  @keyframes eco-fade {
    to { opacity: 1; }
  }

  .eco-entered .eco-dash {
    animation: eco-dash 2s linear infinite;
  }
  @keyframes eco-dash {
    to { stroke-dashoffset: -40; }
  }

  .eco-entered .eco-glow {
    animation: eco-pulse 3s ease-in-out var(--gd) infinite;
  }
  @keyframes eco-pulse {
    0%, 100% { opacity: 0.12; }
    50% { opacity: 0.30; }
  }

  .eco-gov-border {
    opacity: 0;
  }
  .eco-entered .eco-gov-border {
    animation: eco-fade 800ms ease-out 0.4s forwards, eco-crawl 25s linear 1.2s infinite;
  }
  @keyframes eco-crawl {
    to { stroke-dashoffset: -48; }
  }

  .eco-gov-lbl {
    opacity: 0;
  }
  .eco-entered .eco-gov-lbl {
    animation: eco-fade 500ms ease-out 0.6s forwards;
  }

  @media (max-width: 480px) {
    .eco-flow-lbl { display: none; }
    .eco-sub-lbl { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .eco-entered .eco-node,
    .eco-entered .eco-conn,
    .eco-entered .eco-gov-border,
    .eco-entered .eco-gov-lbl {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
    }
    .eco-entered .eco-dash,
    .eco-entered .eco-glow {
      animation: none !important;
    }
  }
`;

/* ── Component ─────────────────────────────────────────── */

export function EcosystemDiagram() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [entered, setEntered] = useState(false);
  const [active, setActive] = useState(-1);

  /* Scroll-triggered entrance */
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setEntered(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Sequential highlight cycle — starts after entrance completes */
  useEffect(() => {
    if (!entered) return;
    let intervalId: ReturnType<typeof setInterval>;
    const timeoutId = setTimeout(() => {
      setActive(0);
      intervalId = setInterval(() => {
        setActive((p) => (p + 1) % CONNS.length);
      }, 2000);
    }, 1200);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [entered]);

  /* Determine which nodes are involved in the active connection */
  const activeFrom = active >= 0 ? CONNS[active].from : null;
  const activeTo = active >= 0 ? CONNS[active].to : null;

  return (
    <>
      <style>{STYLES}</style>
      <svg
        ref={svgRef}
        viewBox="0 0 600 440"
        className={`mx-auto w-full max-w-2xl${entered ? " eco-entered" : ""}`}
        role="img"
        aria-label="Diagram showing the five PROLOG ecosystem components and their interactions"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        <defs>
          {uniqueColors.map((col) => (
            <marker
              key={col}
              id={`arr-${col.slice(1)}`}
              viewBox="0 0 10 7"
              refX="9"
              refY="3.5"
              markerWidth="7"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 3.5L0 7z" fill={col} opacity="0.7" />
            </marker>
          ))}
        </defs>

        {/* ── Governance boundary ── */}
        <rect
          className="eco-gov-border"
          x="28"
          y="18"
          width="544"
          height="420"
          rx="20"
          ry="20"
          fill="none"
          stroke="#0d9488"
          strokeWidth="1.5"
          strokeDasharray="6 8"
        />
        <text
          className="eco-gov-lbl"
          x="300"
          y="12"
          textAnchor="middle"
          fontSize="10"
          fill="#5eead4"
          opacity="0.5"
        >
          Organisational guardrails
        </text>

        {/* ── Connections ── */}
        {CONNS.map((c, i) => {
          const g = connGeo[i];
          const isActive = active === i;
          const markerId = `url(#arr-${c.color.slice(1)})`;
          const strokeOp = active < 0 ? 0.5 : isActive ? 0.9 : 0.25;
          const sw = isActive ? 2.5 : 1.5;
          return (
            <g
              key={i}
              className="eco-conn"
              style={{ "--d": `${0.7 + i * 0.12}s` } as React.CSSProperties}
            >
              <path
                className="eco-dash"
                d={g.d}
                fill="none"
                stroke={c.color}
                strokeWidth={sw}
                strokeOpacity={strokeOp}
                strokeDasharray="8 12"
                strokeLinecap="round"
                markerEnd={markerId}
                markerStart={c.bidir ? markerId : undefined}
                style={{ transition: "stroke-opacity 0.6s, stroke-width 0.6s" }}
              />
              {/* Flow label */}
              <text
                className="eco-flow-lbl"
                x={g.mid.x + (c.labelOff?.[0] ?? 0)}
                y={g.mid.y - 8 + (c.labelOff?.[1] ?? 0)}
                textAnchor="middle"
                fontSize="10"
                fontWeight="500"
                fill="#94a3b8"
                opacity={active < 0 ? 0.7 : isActive ? 0.9 : 0.3}
                stroke="#0d2d3a"
                strokeWidth="3"
                paintOrder="stroke"
                style={{ transition: "opacity 0.6s" }}
              >
                {c.label}
              </text>
            </g>
          );
        })}

        {/* ── Nodes ── */}
        {NODES.map((n, i) => {
          const isActive = n.id === activeFrom || n.id === activeTo;
          return (
            <g
              key={n.id}
              className="eco-node"
              style={
                {
                  "--ox": `${n.cx}px`,
                  "--oy": `${n.cy}px`,
                  "--d": `${i * 0.12}s`,
                } as React.CSSProperties
              }
            >
              {/* Glow pulse */}
              <circle
                className="eco-glow"
                cx={n.cx}
                cy={n.cy}
                r={R + 8}
                fill={n.color}
                opacity="0"
                style={{ "--gd": `${i * 0.6}s` } as React.CSSProperties}
              />
              {/* Circle */}
              <circle
                cx={n.cx}
                cy={n.cy}
                r={R}
                fill={`${n.color}18`}
                stroke={n.color}
                strokeWidth={isActive ? 3 : 2}
                strokeOpacity={isActive ? 1 : 0.8}
                style={{ transition: "stroke-width 0.6s, stroke-opacity 0.6s" }}
              />
              {/* Icon (Lucide 24x24 scaled to 22x22) */}
              <g
                transform={`translate(${n.cx - 11},${n.cy - 11}) scale(${(22 / 24).toFixed(4)})`}
                stroke={n.color}
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {n.icon.map((d, j) => (
                  <path key={j} d={d} />
                ))}
              </g>
              {/* Label */}
              <text
                x={n.cx}
                y={n.cy + R + 17}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#cbd5e1"
              >
                {n.label}
              </text>
              {/* Sub-label */}
              <text
                className="eco-sub-lbl"
                x={n.cx}
                y={n.cy + R + 30}
                textAnchor="middle"
                fontSize="9.5"
                fill="#64748b"
              >
                {n.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
