"use client";

import { useEffect, useRef, useState } from "react";

/* ── Isometric geometry helpers ────────────────────────── */

const COS30 = 0.866;
const SIN30 = 0.5;

/** Three visible faces of an isometric cube with front vertex at (cx, cy). */
function cube(cx: number, cy: number, s: number) {
  const dx = s * COS30;
  const dy = s * SIN30;
  return {
    top: `M${cx},${cy - s} L${cx + dx},${cy - dy} L${cx},${cy} L${cx - dx},${cy - dy}Z`,
    right: `M${cx},${cy} L${cx + dx},${cy + dy} L${cx + dx},${cy - dy} L${cx},${cy - s}Z`,
    left: `M${cx},${cy} L${cx - dx},${cy + dy} L${cx - dx},${cy - dy} L${cx},${cy - s}Z`,
  };
}

/** A single isometric disc (short cylinder). cy = bottom of body. */
function disc(cx: number, cy: number, rx: number, h: number) {
  const ry = rx * SIN30;
  return {
    body: `M${cx - rx},${cy - h}L${cx - rx},${cy}A${rx},${ry} 0 0 1 ${cx + rx},${cy}L${cx + rx},${cy - h}Z`,
    ellipse: { cx, cy: cy - h, rx, ry },
  };
}

/** Diamond (rotated square). */
function diamond(cx: number, cy: number, r: number) {
  return `M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`;
}

/** Quadratic Bezier midpoint at t = 0.5. */
function qMid(
  x0: number,
  y0: number,
  cpx: number,
  cpy: number,
  x1: number,
  y1: number,
): [number, number] {
  return [0.25 * x0 + 0.5 * cpx + 0.25 * x1, 0.25 * y0 + 0.5 * cpy + 0.25 * y1];
}

/* ── Colour palette ────────────────────────────────────── */

const C = {
  /* Simulation Core – AI Counterpart (amber) */
  core: {
    light: "rgba(245,158,11,0.08)",
    mid: "rgba(245,158,11,0.14)",
    dark: "rgba(245,158,11,0.22)",
    stroke: "#f59e0b",
    text: "#92400e",
  },
  /* Simulation Core – Assessment + Escalation (warm orange) */
  esc: {
    light: "rgba(234,88,12,0.08)",
    mid: "rgba(234,88,12,0.14)",
    dark: "rgba(234,88,12,0.22)",
    stroke: "#ea580c",
    text: "#9a3412",
  },
  /* Educator + Scenario Builder (blue) */
  edu: {
    light: "rgba(59,130,246,0.08)",
    mid: "rgba(59,130,246,0.14)",
    dark: "rgba(59,130,246,0.22)",
    stroke: "#3b82f6",
    text: "#1e40af",
  },
  /* Trainee (green) */
  train: {
    light: "rgba(16,185,129,0.08)",
    mid: "rgba(16,185,129,0.14)",
    dark: "rgba(16,185,129,0.22)",
    stroke: "#10b981",
    text: "#065f46",
  },
  /* Review & Feedback (purple) */
  rev: {
    light: "rgba(139,92,246,0.08)",
    mid: "rgba(139,92,246,0.14)",
    dark: "rgba(139,92,246,0.22)",
    stroke: "#8b5cf6",
    text: "#5b21b6",
  },
  /* Governance & Safety (teal) */
  gov: {
    light: "rgba(13,148,136,0.08)",
    mid: "rgba(13,148,136,0.14)",
    dark: "rgba(13,148,136,0.22)",
    stroke: "#0d9488",
    text: "#115e59",
  },
  line: "#d1d5db",
};

/* ── Connection paths ──────────────────────────────────── */

interface Conn {
  id: string;
  d: string;
  dot: string;
  label: string;
  type: "primary" | "main" | "secondary" | "control";
}

const CONNS: Conn[] = [
  /* Educator → Scenario Setup */
  { id: "c1", d: "M108,215 Q118,260 128,298", dot: C.edu.stroke, label: "Authoring", type: "secondary" },
  /* Scenario Setup → Simulation Core */
  { id: "c2", d: "M195,355 Q295,368 378,388", dot: C.edu.stroke, label: "Scenario config", type: "main" },
  /* Trainee ↔ Simulation Core (up – speak / respond) */
  { id: "c3", d: "M305,545 Q380,478 428,438", dot: C.train.stroke, label: "Live conversation", type: "primary" },
  /* Governance → Core (safety constraints) */
  { id: "c4", d: "M500,88 Q500,210 500,328", dot: C.gov.stroke, label: "Safety constraints", type: "control" },
  /* Governance → Scenario (content policies) */
  { id: "c5", d: "M320,60 Q225,175 148,298", dot: C.gov.stroke, label: "Content policies", type: "control" },
  /* Core → Review (session data) */
  { id: "c6", d: "M638,378 Q705,345 760,305", dot: C.core.stroke, label: "Session data", type: "main" },
  /* Review → Trainee (scores & feedback) */
  { id: "c7", d: "M762,400 Q540,500 318,558", dot: C.rev.stroke, label: "Scores & feedback", type: "secondary" },
];

const connMids = CONNS.map((c) => {
  const m = c.d.match(/M([\d.]+),([\d.]+)\s*Q([\d.]+),([\d.]+)\s*([\d.]+),([\d.]+)/);
  if (!m) return [0, 0] as [number, number];
  return qMid(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
});

/* ── Decorative diamonds (reduced set) ─────────────────── */

const DIAMONDS = [
  { cx: 340, cy: 148, r: 8, color: "#ec4899", opacity: 0.22 },
  { cx: 665, cy: 490, r: 9, color: "#ec4899", opacity: 0.18 },
  { cx: 910, cy: 195, r: 7, color: "#ec4899", opacity: 0.22 },
  { cx: 78, cy: 440, r: 7, color: "#ec4899", opacity: 0.24 },
];

/* ── CSS keyframes ─────────────────────────────────────── */

const STYLES = `
  .isov2-float-a { animation: isov2-bob 4.0s ease-in-out infinite; }
  .isov2-float-b { animation: isov2-bob 4.5s ease-in-out infinite; }
  .isov2-float-c { animation: isov2-bob 3.6s ease-in-out infinite; }
  .isov2-float-d { animation: isov2-bob 5.0s ease-in-out infinite; }
  .isov2-float-e { animation: isov2-bob 3.9s ease-in-out infinite; }
  @keyframes isov2-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-6px); }
  }

  .isov2-dia {
    animation: isov2-spin 28s linear infinite;
  }
  @keyframes isov2-spin {
    to { transform: rotate(360deg); }
  }

  .isov2-g {
    opacity: 0;
  }
  .isov2-on .isov2-g {
    animation: isov2-up 700ms ease-out forwards;
    animation-delay: var(--d);
  }
  @keyframes isov2-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .isov2-ln {
    opacity: 0;
  }
  .isov2-on .isov2-ln {
    animation: isov2-fi 500ms ease-out var(--d) forwards;
  }
  @keyframes isov2-fi {
    to { opacity: 1; }
  }

  @media (max-width: 640px) {
    .isov2-cl { display: none; }
    .isov2-micro { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .isov2-float-a, .isov2-float-b, .isov2-float-c,
    .isov2-float-d, .isov2-float-e, .isov2-dia {
      animation: none !important;
    }
    .isov2-on .isov2-g, .isov2-on .isov2-ln {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
    }
  }
`;

/* ── Component ─────────────────────────────────────────── */

export function IsometricDiagramV2() {
  const ref = useRef<SVGSVGElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ── Pre-compute shapes ──────────────────────────────── */

  /* Scenario Builder – isometric cube (left) */
  const scenCube = cube(140, 355, 50);

  /* Simulation Core – AI Counterpart tower (centre-left) */
  const coreL1 = disc(435, 428, 58, 20);
  const coreL2 = disc(435, 398, 58, 20);
  const coreL3 = disc(435, 368, 58, 20);

  /* Simulation Core – Assessment + Escalation tower (centre-right) */
  const coreR1 = disc(572, 428, 58, 20);
  const coreR2 = disc(572, 398, 58, 20);
  const coreR3 = disc(572, 368, 58, 20);

  /* Review capsules (right) */
  /* positioned later inline */

  /* Wireframe decoration cube (one only) */
  const wf1 = cube(930, 520, 16);

  const mono = "'SF Mono','Fira Code','Cascadia Code',monospace";
  const sans = "system-ui,-apple-system,sans-serif";

  /* ── Stroke helpers per connection type ───────────────── */
  function connStroke(type: Conn["type"]) {
    if (type === "primary") return { w: 2.2, dash: "none", opacity: 0.7 };
    if (type === "main") return { w: 1.4, dash: "6 4", opacity: 0.6 };
    if (type === "control") return { w: 1.0, dash: "3 4", opacity: 0.5 };
    return { w: 1.2, dash: "6 4", opacity: 0.55 };
  }

  return (
    <>
      <style>{STYLES}</style>
      <svg
        ref={ref}
        viewBox="0 0 1000 680"
        className={`mx-auto w-full${on ? " isov2-on" : ""}`}
        role="img"
        aria-label="Platform architecture diagram showing the adaptive simulation core with AI counterpart and assessment engine"
        fontFamily={sans}
      >
        <defs>
          {/* Arrowhead markers for primary connection */}
          <marker id="arr-train" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 3.5L0 7z" fill={C.train.stroke} opacity="0.7" />
          </marker>
          <marker id="arr-core" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 3.5L0 7z" fill={C.core.stroke} opacity="0.7" />
          </marker>
        </defs>

        {/* ═══════════════════════════════════════════════════
            LAYER 0 – Connection paths + traveling dots
        ═══════════════════════════════════════════════════ */}
        {CONNS.map((c, i) => {
          const [mx, my] = connMids[i];
          const s = connStroke(c.type);
          return (
            <g key={c.id} className="isov2-ln" style={{ "--d": `${0.4 + i * 0.08}s` } as React.CSSProperties}>
              <path
                id={c.id}
                d={c.d}
                fill="none"
                stroke={c.type === "primary" ? C.train.stroke : C.line}
                strokeWidth={s.w}
                strokeDasharray={s.dash}
                strokeOpacity={s.opacity}
                markerEnd={c.type === "primary" ? "url(#arr-core)" : undefined}
                markerStart={c.type === "primary" ? "url(#arr-train)" : undefined}
              />
              {/* Traveling dots */}
              <circle r={c.type === "primary" ? 4 : 3} fill={c.dot} opacity="0.7">
                <animateMotion dur={c.type === "primary" ? "3s" : "4s"} begin="0s" repeatCount="indefinite">
                  <mpath href={`#${c.id}`} />
                </animateMotion>
              </circle>
              <circle r={c.type === "primary" ? 3.5 : 2.5} fill={c.dot} opacity="0.4">
                <animateMotion dur={c.type === "primary" ? "3s" : "4s"} begin="-1.5s" repeatCount="indefinite">
                  <mpath href={`#${c.id}`} />
                </animateMotion>
              </circle>
              {/* Connection label badge */}
              <g className="isov2-cl" transform={`translate(${mx},${my - 12})`}>
                <rect
                  x={-(c.label.length * 3.6 + 8)}
                  y="-9"
                  width={c.label.length * 7.2 + 16}
                  height="18"
                  rx="2"
                  fill="white"
                  stroke="#e5e7eb"
                  strokeWidth="0.6"
                />
                <text x="0" y="4" textAnchor="middle" fontSize="8.5" fontFamily={mono} fontWeight="500" fill="#6b7280" letterSpacing="0.04em">
                  {c.label}
                </text>
              </g>
            </g>
          );
        })}

        {/* ═══════════════════════════════════════════════════
            LAYER 1 – Pulse rings around Simulation Core
        ═══════════════════════════════════════════════════ */}
        {[0, -1, -2].map((begin) => (
          <circle key={begin} cx="503" cy="390" fill="none" stroke={C.core.stroke} strokeWidth="1">
            <animate attributeName="r" values="90;165" dur="3.5s" begin={`${begin}s`} repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.25;0" dur="3.5s" begin={`${begin}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* ═══════════════════════════════════════════════════
            LAYER 2 – Decorative diamonds (reduced)
        ═══════════════════════════════════════════════════ */}
        {DIAMONDS.map((d, i) => (
          <g key={`dia-${i}`} className="isov2-dia" style={{ transformOrigin: `${d.cx}px ${d.cy}px` }}>
            <path d={diamond(d.cx, d.cy, d.r)} fill={d.color} opacity={d.opacity} />
          </g>
        ))}

        {/* Wireframe cube (one subtle decoration) */}
        <g opacity="0.15" fill="none" stroke="#94a3b8" strokeWidth="0.7">
          <path d={wf1.top} />
          <path d={wf1.right} />
          <path d={wf1.left} />
        </g>

        {/* ═══════════════════════════════════════════════════
            GOVERNANCE & SAFETY – top overlay bar
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.15s" } as React.CSSProperties}>
          <g className="isov2-float-e">
            {/* Dashed outline container */}
            <rect
              x="245"
              y="18"
              width="510"
              height="60"
              rx="6"
              fill={C.gov.light}
              stroke={C.gov.stroke}
              strokeWidth="1.2"
              strokeDasharray="5 3"
            />
            {/* Shield icon */}
            <path
              d="M486,34 L486,46 Q486,51 492,54 Q486,51 480,54 Q486,51 486,46Z"
              fill="none"
              stroke={C.gov.stroke}
              strokeWidth="0.9"
              opacity="0.6"
            />
            <text x="500" y="42" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.gov.text} letterSpacing="0.06em">
              GOVERNANCE & SAFETY
            </text>
            <text x="500" y="60" textAnchor="middle" fontSize="7.5" fontFamily={sans} fill={C.gov.text} opacity="0.7" letterSpacing="0.02em">
              content policies · escalation limits · consent gates · session time · safety rules
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            EDUCATOR – actor (upper-left circle)
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.2s" } as React.CSSProperties}>
          <g className="isov2-float-b">
            {/* Outer ring */}
            <circle cx="108" cy="170" r="32" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.4" />
            {/* Person icon (head + shoulders) */}
            <circle cx="108" cy="160" r="7" fill="none" stroke={C.edu.stroke} strokeWidth="1.2" opacity="0.6" />
            <path d="M93,185 Q93,173 108,173 Q123,173 123,185" fill="none" stroke={C.edu.stroke} strokeWidth="1.2" opacity="0.6" />
            {/* Label */}
            <text x="108" y="218" textAnchor="middle" fontSize="11" fontFamily={sans} fontWeight="600" fill={C.edu.text} letterSpacing="0.03em">
              EDUCATOR
            </text>
            {/* Role hint */}
            <text className="isov2-micro" x="108" y="232" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.edu.text} opacity="0.6">
              designs scenarios & reviews
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            SCENARIO SETUP – system cube (left)
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.28s" } as React.CSSProperties}>
          <g className="isov2-float-b">
            <path d={scenCube.left} fill={C.edu.dark} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scenCube.right} fill={C.edu.mid} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scenCube.top} fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.2" />
            {/* Small lines on right face (like a settings panel) */}
            <line x1="148" y1="322" x2="175" y2="336" stroke={C.edu.stroke} strokeWidth="0.7" opacity="0.45" />
            <line x1="148" y1="330" x2="175" y2="344" stroke={C.edu.stroke} strokeWidth="0.7" opacity="0.45" />
            <line x1="148" y1="338" x2="170" y2="349" stroke={C.edu.stroke} strokeWidth="0.7" opacity="0.35" />
            {/* Label */}
            <rect x="74" y="410" width="132" height="22" rx="3" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="0.8" />
            <text x="140" y="425" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.edu.text} letterSpacing="0.06em">
              SCENARIO SETUP
            </text>
            {/* Sub-labels */}
            <text className="isov2-micro" x="140" y="444" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.edu.text} opacity="0.55">
              personality dials · escalation rules
            </text>
            <text className="isov2-micro" x="140" y="455" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.edu.text} opacity="0.55">
              milestones · voice · objectives
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            SIMULATION CORE – dual-tower centre
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.1s" } as React.CSSProperties}>
          <g className="isov2-float-a">
            {/* ── Bounding container (subtle dashed outline) ── */}
            <rect
              x="365"
              y="298"
              width="278"
              height="162"
              rx="8"
              fill="rgba(245,158,11,0.03)"
              stroke={C.core.stroke}
              strokeWidth="0.8"
              strokeDasharray="4 3"
              opacity="0.5"
            />

            {/* ── AI Counterpart tower (left) ── */}
            {[coreL1, coreL2, coreL3].map((d, i) => (
              <g key={`cl-${i}`}>
                <path d={d.body} fill={i === 0 ? C.core.dark : C.core.mid} stroke={C.core.stroke} strokeWidth="1.2" />
                <ellipse
                  cx={d.ellipse.cx}
                  cy={d.ellipse.cy}
                  rx={d.ellipse.rx}
                  ry={d.ellipse.ry}
                  fill={C.core.light}
                  stroke={C.core.stroke}
                  strokeWidth="1.2"
                />
              </g>
            ))}
            {/* Tower label */}
            <text x="435" y="328" textAnchor="middle" fontSize="8" fontFamily={mono} fontWeight="600" fill={C.core.text} letterSpacing="0.04em">
              AI COUNTERPART
            </text>
            {/* Sub-labels */}
            <text className="isov2-micro" x="435" y="312" textAnchor="middle" fontSize="6.5" fontFamily={sans} fill={C.core.text} opacity="0.6">
              voice · behaviour · adaptation
            </text>

            {/* ── Bridge connector between towers ── */}
            <line x1="493" y1="388" x2="514" y2="388" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.5" />
            <line x1="493" y1="392" x2="514" y2="392" stroke={C.esc.stroke} strokeWidth="1.5" opacity="0.5" />
            {/* Bidirectional arrows on bridge */}
            <path d="M496,386 L493,390 L496,394" fill="none" stroke={C.core.stroke} strokeWidth="1" opacity="0.5" />
            <path d="M511,386 L514,390 L511,394" fill="none" stroke={C.esc.stroke} strokeWidth="1" opacity="0.5" />

            {/* ── Assessment + Escalation tower (right) ── */}
            {[coreR1, coreR2, coreR3].map((d, i) => (
              <g key={`cr-${i}`}>
                <path d={d.body} fill={i === 0 ? C.esc.dark : C.esc.mid} stroke={C.esc.stroke} strokeWidth="1.2" />
                <ellipse
                  cx={d.ellipse.cx}
                  cy={d.ellipse.cy}
                  rx={d.ellipse.rx}
                  ry={d.ellipse.ry}
                  fill={C.esc.light}
                  stroke={C.esc.stroke}
                  strokeWidth="1.2"
                />
              </g>
            ))}
            {/* Tower label */}
            <text x="572" y="328" textAnchor="middle" fontSize="7.5" fontFamily={mono} fontWeight="600" fill={C.esc.text} letterSpacing="0.04em">
              ASSESSMENT +
            </text>
            <text x="572" y="339" textAnchor="middle" fontSize="7.5" fontFamily={mono} fontWeight="600" fill={C.esc.text} letterSpacing="0.04em">
              ESCALATION
            </text>
            {/* Sub-labels */}
            <text className="isov2-micro" x="572" y="312" textAnchor="middle" fontSize="6.5" fontFamily={sans} fill={C.esc.text} opacity="0.6">
              classification · evidence · scoring
            </text>

            {/* ── Overall core label ── */}
            <rect x="410" y="475" width="190" height="24" rx="4" fill={C.core.light} stroke={C.core.stroke} strokeWidth="0.9" />
            <text x="505" y="491" textAnchor="middle" fontSize="11" fontFamily={mono} fontWeight="700" fill={C.core.text} letterSpacing="0.06em">
              SIMULATION CORE
            </text>
            {/* Descriptor */}
            <text className="isov2-micro" x="505" y="510" textAnchor="middle" fontSize="7.5" fontFamily={sans} fill={C.core.text} opacity="0.6">
              live roleplay + live assessment working together
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            TRAINEE – actor (lower-left circle)
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.35s" } as React.CSSProperties}>
          <g className="isov2-float-c">
            {/* Outer ring */}
            <circle cx="285" cy="570" r="32" fill={C.train.light} stroke={C.train.stroke} strokeWidth="1.4" />
            {/* Person icon */}
            <circle cx="285" cy="560" r="7" fill="none" stroke={C.train.stroke} strokeWidth="1.2" opacity="0.6" />
            <path d="M270,585 Q270,573 285,573 Q300,573 300,585" fill="none" stroke={C.train.stroke} strokeWidth="1.2" opacity="0.6" />
            {/* Microphone accent */}
            <line x1="285" y1="554" x2="285" y2="548" stroke={C.train.stroke} strokeWidth="0.8" opacity="0.4" />
            <path d="M280,548 L290,548" fill="none" stroke={C.train.stroke} strokeWidth="0.8" opacity="0.4" />
            {/* Label */}
            <text x="285" y="618" textAnchor="middle" fontSize="11" fontFamily={sans} fontWeight="600" fill={C.train.text} letterSpacing="0.03em">
              TRAINEE
            </text>
            {/* Role hint */}
            <text className="isov2-micro" x="285" y="632" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.train.text} opacity="0.6">
              speak · listen · respond · adapt
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            REVIEW & FEEDBACK – stacked capsules (right)
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.25s" } as React.CSSProperties}>
          <g className="isov2-float-d">
            {/* Capsule 1 – Review & Feedback */}
            <g transform="rotate(-25,810,235)">
              <rect x="748" y="224" width="124" height="22" rx="11" fill={C.rev.dark} stroke={C.rev.stroke} strokeWidth="1.2" />
            </g>
            {/* Capsule 2 – Evidence Review */}
            <g transform="rotate(-25,830,272)">
              <rect x="768" y="261" width="124" height="22" rx="11" fill={C.rev.mid} stroke={C.rev.stroke} strokeWidth="1.2" />
            </g>
            {/* Capsule 3 – Session Analysis */}
            <g transform="rotate(-25,810,309)">
              <rect x="748" y="298" width="124" height="22" rx="11" fill={C.rev.light} stroke={C.rev.stroke} strokeWidth="1.2" />
            </g>
            {/* Capsule 4 – Transcript & Replay (outline only) */}
            <g transform="rotate(-25,830,346)">
              <rect x="768" y="335" width="124" height="22" rx="11" fill="none" stroke={C.rev.stroke} strokeWidth="1.2" />
            </g>

            {/* Label group */}
            <rect x="728" y="398" width="160" height="22" rx="3" fill={C.rev.light} stroke={C.rev.stroke} strokeWidth="0.8" />
            <text x="808" y="413" textAnchor="middle" fontSize="10" fontFamily={mono} fontWeight="600" fill={C.rev.text} letterSpacing="0.06em">
              REVIEW & FEEDBACK
            </text>
            {/* Sub-labels */}
            <text className="isov2-micro" x="808" y="432" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.rev.text} opacity="0.55">
              evidence review · session analysis
            </text>
            <text className="isov2-micro" x="808" y="443" textAnchor="middle" fontSize="7" fontFamily={sans} fill={C.rev.text} opacity="0.55">
              transcript · replay · scoring
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            FLOW DIRECTION HINT – subtle background arrow
        ═══════════════════════════════════════════════════ */}
        <g className="isov2-g" style={{ "--d": "0.5s" } as React.CSSProperties}>
          <text x="500" y="560" textAnchor="middle" fontSize="9" fontFamily={sans} fontWeight="500" fill="#9ca3af" opacity="0.5" letterSpacing="0.15em">
            EDUCATOR → SIMULATION → REVIEW
          </text>
        </g>
      </svg>
    </>
  );
}
