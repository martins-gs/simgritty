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
  /* Educator / authoring layer (blue) */
  edu: {
    light: "rgba(59,130,246,0.08)",
    mid: "rgba(59,130,246,0.14)",
    dark: "rgba(59,130,246,0.22)",
    stroke: "#3b82f6",
    text: "#1e40af",
  },
  /* Live runtime core (amber/green) */
  core: {
    light: "rgba(16,185,129,0.08)",
    mid: "rgba(16,185,129,0.14)",
    dark: "rgba(16,185,129,0.22)",
    stroke: "#10b981",
    text: "#065f46",
  },
  /* Trainee (teal) */
  train: {
    light: "rgba(13,148,136,0.08)",
    mid: "rgba(13,148,136,0.14)",
    dark: "rgba(13,148,136,0.22)",
    stroke: "#0d9488",
    text: "#115e59",
  },
  /* Review & Feedback (purple) */
  rev: {
    light: "rgba(139,92,246,0.08)",
    mid: "rgba(139,92,246,0.14)",
    dark: "rgba(139,92,246,0.22)",
    stroke: "#8b5cf6",
    text: "#5b21b6",
  },
  /* Safety / domain (orange) */
  safety: {
    light: "rgba(234,88,12,0.08)",
    mid: "rgba(234,88,12,0.14)",
    dark: "rgba(234,88,12,0.22)",
    stroke: "#ea580c",
    text: "#9a3412",
  },
  line: "#d1d5db",
};

/* ── Connection paths ──────────────────────────────────── */

interface Conn {
  id: string;
  d: string;
  dot: string;
  label: string;
  type: "primary" | "main" | "secondary";
}

const CONNS: Conn[] = [
  /* Educator → top row authoring modules */
  { id: "c1", d: "M550,126 Q400,170 250,200", dot: "#8b5cf6", label: "defines", type: "secondary" },
  { id: "c2", d: "M550,126 Q500,170 450,200", dot: "#8b5cf6", label: "sets", type: "secondary" },
  { id: "c3", d: "M550,126 Q600,170 650,200", dot: "#8b5cf6", label: "provides", type: "secondary" },
  { id: "c4", d: "M550,126 Q700,170 850,200", dot: "#8b5cf6", label: "authors", type: "secondary" },
  
  /* Top row → middle row */
  { id: "c5", d: "M250,295 Q295,345 340,395", dot: C.edu.stroke, label: "guides", type: "main" },
  { id: "c6", d: "M450,295 Q500,345 550,395", dot: C.safety.stroke, label: "constrains", type: "main" },
  { id: "c7", d: "M650,295 Q600,345 550,395", dot: C.edu.stroke, label: "grounds", type: "main" },
  { id: "c8", d: "M850,295 Q805,345 760,395", dot: C.edu.stroke, label: "shapes", type: "main" },
  
  /* Core interconnections */
  { id: "c9", d: "M380,432 Q465,432 550,432", dot: C.core.stroke, label: "drives", type: "main" },
  { id: "c10", d: "M550,462 Q465,462 380,462", dot: C.core.stroke, label: "updates", type: "main" },
  { id: "c11", d: "M590,438 Q675,438 760,438", dot: C.core.stroke, label: "provides evidence", type: "main" },
  { id: "c12", d: "M720,458 Q635,458 550,458", dot: C.core.stroke, label: "informs", type: "main" },
  
  /* Trainee → AI Counterpart */
  { id: "c13", d: "M340,617 Q340,560 340,491", dot: C.train.stroke, label: "converses with", type: "main" },
  
  /* Assessment Engine → Review & Feedback */
  { id: "c14", d: "M760,491 Q760,560 760,631", dot: C.core.stroke, label: "generates", type: "main" },
  /* Trainee → Review & Feedback */
  { id: "c15", d: "M366,645 Q513,645 660,645", dot: C.rev.stroke, label: "reviews", type: "secondary" },
];

const connMids = CONNS.map((c) => {
  const m = c.d.match(/M([\d.]+),([\d.]+)\s*Q([\d.]+),([\d.]+)\s*([\d.]+),([\d.]+)/);
  if (!m) return [0, 0] as [number, number];
  return qMid(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
});

/* ── Decorative diamonds ───────────────────────────────── */

const DIAMONDS = [
  { cx: 200, cy: 200, r: 7, color: "#ec4899", opacity: 0.20 },
  { cx: 720, cy: 180, r: 8, color: "#ec4899", opacity: 0.18 },
  { cx: 900, cy: 400, r: 7, color: "#ec4899", opacity: 0.22 },
  { cx: 150, cy: 500, r: 8, color: "#ec4899", opacity: 0.20 },
];

/* ── CSS keyframes ─────────────────────────────────────── */

const STYLES = `
  .isov3-float-a { animation: isov3-bob 4.0s ease-in-out infinite; }
  .isov3-float-b { animation: isov3-bob 4.5s ease-in-out infinite; }
  .isov3-float-c { animation: isov3-bob 3.6s ease-in-out infinite; }
  .isov3-float-d { animation: isov3-bob 5.0s ease-in-out infinite; }
  .isov3-float-e { animation: isov3-bob 3.9s ease-in-out infinite; }
  @keyframes isov3-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-6px); }
  }
  
  /* AI Counterpart - breathing pulse animation */
  .isov3-ai-pulse { animation: isov3-pulse 5s ease-in-out infinite; }
  @keyframes isov3-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.65; }
  }
  
  /* Behavioural Model - node/path activation */
  .isov3-beh-node { animation: isov3-node-flow 6s ease-in-out infinite; }
  @keyframes isov3-node-flow {
    0%, 100% { opacity: 0.2; r: 2; }
    50% { opacity: 0.8; r: 3; }
  }
  
  /* Assessment Engine - scanning/metric fill */
  .isov3-ass-scan { animation: isov3-scan 4s ease-in-out infinite; }
  @keyframes isov3-scan {
    0% { transform: translateY(0); opacity: 0.6; }
    50% { transform: translateY(-20px); opacity: 0.3; }
    100% { transform: translateY(0); opacity: 0.6; }
  }

  .isov3-dia {
    animation: isov3-spin 28s linear infinite;
  }
  @keyframes isov3-spin {
    to { transform: rotate(360deg); }
  }

  .isov3-g {
    opacity: 0;
  }
  .isov3-on .isov3-g {
    animation: isov3-up 700ms ease-out forwards;
    animation-delay: var(--d);
  }
  @keyframes isov3-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .isov3-ln {
    opacity: 0;
  }
  .isov3-on .isov3-ln {
    animation: isov3-fi 500ms ease-out var(--d) forwards;
  }
  @keyframes isov3-fi {
    to { opacity: 1; }
  }

  @media (max-width: 640px) {
    .isov3-cl { display: none; }
    .isov3-micro { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .isov3-float-a, .isov3-float-b, .isov3-float-c,
    .isov3-float-d, .isov3-float-e, .isov3-dia {
      animation: none !important;
    }
    .isov3-on .isov3-g, .isov3-on .isov3-ln {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
    }
  }
`;

/* ── Component ─────────────────────────────────────────── */

export function IsometricDiagramV3() {
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

  /* TOP - Educator */
  const eduCube = cube(550, 100, 26);

  /* TOP ROW - Authoring modules (horizontally arranged) */
  const scoreCube = cube(250, 260, 36);         // Scoring Rubric (left)
  const safetyCube = cube(450, 260, 36);        // Safety Constraints (center-left)
  const domainCube = cube(650, 260, 36);        // Domain Knowledge (center-right)
  const scenCube = cube(850, 260, 36);          // Scenario (right)

  /* MIDDLE ROW - Live Runtime Core (3 glass AI modules)
     rx=40 → ry=20 → bottom arc extends 20px below cy 
     Bottom disc cy=470 → arc bottom at 490 */
  const aiD1 = disc(340, 470, 40, 15);          // AI Counterpart - Staff (bottom)
  const aiD2 = disc(340, 445, 40, 15);          // AI Counterpart - Relative (middle)
  const aiD3 = disc(340, 420, 40, 15);          // AI Counterpart - Patient (top)

  const behD1 = disc(550, 470, 40, 15);         // Behavioural Model (center)
  const behD2 = disc(550, 445, 40, 15);
  const behD3 = disc(550, 420, 40, 15);

  const assD1 = disc(760, 470, 40, 15);         // Assessment Engine (right)
  const assD2 = disc(760, 445, 40, 15);
  const assD3 = disc(760, 420, 40, 15);

  /* BOTTOM ROW */
  // Trainee at (340, 625) - below AI Counterpart
  // Review & Feedback at (760, 625) - below Assessment Engine

  /* Wireframe decoration cube */
  const wf1 = cube(900, 150, 14);

  const mono = "'SF Mono','Fira Code','Cascadia Code',monospace";
  const sans = "system-ui,-apple-system,sans-serif";

  /* ── Stroke helpers per connection type ───────────────── */
  function connStroke(type: Conn["type"]) {
    if (type === "primary") return { w: 1.6, dash: "6 4", opacity: 0.65 };
    if (type === "main") return { w: 1.4, dash: "6 4", opacity: 0.6 };
    return { w: 1.2, dash: "6 4", opacity: 0.55 };
  }

  return (
    <>
      <style>{STYLES}</style>
      <svg
        ref={ref}
        viewBox="0 0 1100 800"
        overflow="visible"
        className={`mx-auto w-full${on ? " isov3-on" : ""}`}
        role="img"
        aria-label="System architecture diagram showing educator authoring, live runtime core with AI counterpart, behavioural model, assessment engine, and trainee interaction"
        fontFamily={sans}
      >
        <defs>
          {/* Arrowhead markers for primary connections */}
          <marker
            id="arr-train"
            viewBox="0 0 10 7"
            refX="9"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 3.5L0 7z" fill={C.train.stroke} opacity="0.7" />
          </marker>
          <marker
            id="arr-core"
            viewBox="0 0 10 7"
            refX="9"
            refY="3.5"
            markerWidth="8"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 3.5L0 7z" fill={C.core.stroke} opacity="0.7" />
          </marker>
        </defs>

        {/* ═══════════════════════════════════════════════════
            LAYER 0 – Connection paths + traveling dots
        ═══════════════════════════════════════════════════ */}
        {CONNS.map((c, i) => {
          const [mx, my] = connMids[i];
          const s = connStroke(c.type);
          const isPrimary = c.type === "primary";
          return (
            <g key={c.id} className="isov3-ln" style={{ "--d": `${0.4 + i * 0.05}s` } as React.CSSProperties}>
              <path
                id={c.id}
                d={c.d}
                fill="none"
                stroke={isPrimary ? c.dot : C.line}
                strokeWidth={s.w}
                strokeDasharray={s.dash}
                strokeOpacity={s.opacity}
                markerEnd={isPrimary && c.label === "converses with" ? undefined : undefined}
              />
              {/* Traveling dots */}
              <circle r="3" fill={c.dot} opacity="0.7">
                <animateMotion dur="4s" begin="0s" repeatCount="indefinite">
                  <mpath href={`#${c.id}`} />
                </animateMotion>
              </circle>
              <circle r="2.5" fill={c.dot} opacity="0.4">
                <animateMotion dur="4s" begin="-2s" repeatCount="indefinite">
                  <mpath href={`#${c.id}`} />
                </animateMotion>
              </circle>
              {/* Bidirectional dots for converses with */}
              {c.label === "converses with" && (
                <>
                  <circle r="3" fill={c.dot} opacity="0.7">
                    <animateMotion dur="4s" begin="0s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear">
                      <mpath href={`#${c.id}`} />
                    </animateMotion>
                  </circle>
                  <circle r="2.5" fill={c.dot} opacity="0.4">
                    <animateMotion dur="4s" begin="-2s" repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear">
                      <mpath href={`#${c.id}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
              {/* Connection label badge */}
              <g className="isov3-cl" transform={`translate(${mx},${my - 12})`}>
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
                <text
                  x="0"
                  y="4"
                  textAnchor="middle"
                  fontSize="8.5"
                  fontFamily={mono}
                  fontWeight="500"
                  fill="#6b7280"
                  letterSpacing="0.04em"
                >
                  {c.label}
                </text>
              </g>
            </g>
          );
        })}

        {/* ═══════════════════════════════════════════════════
            LAYER 1 – Pulse rings around live runtime core
        ═══════════════════════════════════════════════════ */}
        {[0, -1.2, -2.4].map((begin) => (
          <circle key={begin} cx="510" cy="450" fill="none" stroke={C.core.stroke} strokeWidth="1">
            <animate attributeName="r" values="110;200" dur="4s" begin={`${begin}s`} repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.25;0" dur="4s" begin={`${begin}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* ═══════════════════════════════════════════════════
            LAYER 2 – Decorative diamonds
        ═══════════════════════════════════════════════════ */}
        {DIAMONDS.map((d, i) => (
          <g key={`dia-${i}`} className="isov3-dia" style={{ transformOrigin: `${d.cx}px ${d.cy}px` }}>
            <path d={diamond(d.cx, d.cy, d.r)} fill={d.color} opacity={d.opacity} />
          </g>
        ))}

        {/* Wireframe cube decoration */}
        <g opacity="0.15" fill="none" stroke="#94a3b8" strokeWidth="0.7">
          <path d={wf1.top} />
          <path d={wf1.right} />
          <path d={wf1.left} />
        </g>

        {/* ═══════════════════════════════════════════════════
            LAYER LABELS – section headers (static, no animation)
        ═══════════════════════════════════════════════════ */}
        <g>
          <text x="550" y="175" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill="#9ca3af" letterSpacing="0.08em">
            AUTHORING LAYER
          </text>
          <text x="550" y="710" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill="#9ca3af" letterSpacing="0.08em">
            OUTPUT & INTERACTION
          </text>
        </g>

        {/* ═══════════════════════════════════════════════════
            EDUCATOR – top center
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.2s" } as React.CSSProperties}>
          <g className="isov3-float-b">
            {/* Purple circle with person icon, same style as Trainee */}
            <circle cx="550" cy="100" r="26" fill="rgba(139,92,246,0.08)" stroke="#8b5cf6" strokeWidth="1.4" />
            {/* Person icon */}
            <circle cx="550" cy="93" r="6" fill="none" stroke="#8b5cf6" strokeWidth="1.1" opacity="0.6" />
            <path d="M538,112 Q538,104 550,104 Q562,104 562,112" fill="none" stroke="#8b5cf6" strokeWidth="1.1" opacity="0.6" />
            {/* Label */}
            <rect x="507" y="55" width="86" height="18" rx="3" fill="rgba(139,92,246,0.08)" stroke="#8b5cf6" strokeWidth="0.8" />
            <text x="550" y="68" textAnchor="middle" fontSize="9.5" fontFamily={mono} fontWeight="600" fill="#5b21b6" letterSpacing="0.06em">
              Educator
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            SCENARIO – right
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.25s" } as React.CSSProperties}>
          <g className="isov3-float-b">
            <path d={scenCube.left} fill={C.edu.dark} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scenCube.right} fill={C.edu.mid} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scenCube.top} fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.2" />
            {/* Label */}
            <rect x="800" y="188" width="100" height="18" rx="3" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="0.8" />
            <text x="850" y="201" textAnchor="middle" fontSize="9.5" fontFamily={mono} fontWeight="600" fill={C.edu.text} letterSpacing="0.06em">
              Scenario
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            DOMAIN KNOWLEDGE – center-right
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.28s" } as React.CSSProperties}>
          <g className="isov3-float-c">
            <path d={domainCube.left} fill={C.edu.dark} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={domainCube.right} fill={C.edu.mid} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={domainCube.top} fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.2" />
            {/* Label */}
            <rect x="585" y="188" width="130" height="18" rx="3" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="0.8" />
            <text x="650" y="201" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.edu.text} letterSpacing="0.05em">
              Domain Knowledge
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            SAFETY CONSTRAINTS – center-left
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.3s" } as React.CSSProperties}>
          <g className="isov3-float-d">
            <path d={safetyCube.left} fill={C.safety.dark} stroke={C.safety.stroke} strokeWidth="1.2" />
            <path d={safetyCube.right} fill={C.safety.mid} stroke={C.safety.stroke} strokeWidth="1.2" />
            <path d={safetyCube.top} fill={C.safety.light} stroke={C.safety.stroke} strokeWidth="1.2" />
            {/* Label */}
            <rect x="380" y="188" width="140" height="18" rx="3" fill={C.safety.light} stroke={C.safety.stroke} strokeWidth="0.8" />
            <text x="450" y="201" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.safety.text} letterSpacing="0.05em">
              Safety Constraints
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            SCORING RUBRIC – left
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.32s" } as React.CSSProperties}>
          <g className="isov3-float-e">
            <path d={scoreCube.left} fill={C.edu.dark} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scoreCube.right} fill={C.edu.mid} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={scoreCube.top} fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.2" />
            {/* Label */}
            <rect x="190" y="188" width="120" height="18" rx="3" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="0.8" />
            <text x="250" y="201" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.edu.text} letterSpacing="0.05em">
              Scoring Rubric
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════════
            LIVE RUNTIME CORE – futuristic glass AI modules
        ═══════════════════════════════════════════════════ */}
        <g className="isov3-g" style={{ "--d": "0.1s" } as React.CSSProperties}>
          <g className="isov3-float-a">
            {/* Subtle bounding container - must fully contain disc arcs */}
            <rect
              x="270"
              y="395"
              width="560"
              height="110"
              rx="8"
              fill="rgba(16,185,129,0.02)"
              stroke={C.core.stroke}
              strokeWidth="0.6"
              strokeDasharray="6 4"
              opacity="0.35"
            />

            {/* ── AI COUNTERPART (left tower) - Three distinct labeled discs ── */}
            
            {/* Bottom disc - Staff (glass-like chamber) */}
            <g>
              <path d={aiD1.body} fill="rgba(16,185,129,0.06)" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.9" />
              <ellipse
                cx={aiD1.ellipse.cx}
                cy={aiD1.ellipse.cy}
                rx={aiD1.ellipse.rx}
                ry={aiD1.ellipse.ry}
                fill="rgba(255,255,255,0.4)"
                stroke={C.core.stroke}
                strokeWidth="1.5"
                opacity="0.85"
              />
              {/* Pulsing inner glow */}
              <ellipse className="isov3-ai-pulse" cx="340" cy="455" rx="25" ry="12" fill={C.core.stroke} opacity="0.15" />
              <text x="340" y="472" textAnchor="middle" fontSize="8" fontFamily={mono} fontWeight="700" fill={C.core.text} letterSpacing="0.04em">
                Staff
              </text>
            </g>
            
            {/* Middle disc - Relative (glass-like chamber) */}
            <g>
              <path d={aiD2.body} fill="rgba(16,185,129,0.06)" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.9" />
              <ellipse
                cx={aiD2.ellipse.cx}
                cy={aiD2.ellipse.cy}
                rx={aiD2.ellipse.rx}
                ry={aiD2.ellipse.ry}
                fill="rgba(255,255,255,0.4)"
                stroke={C.core.stroke}
                strokeWidth="1.5"
                opacity="0.85"
              />
              {/* Pulsing inner glow */}
              <ellipse className="isov3-ai-pulse" cx="340" cy="430" rx="25" ry="12" fill={C.core.stroke} opacity="0.15" />
              <text x="340" y="447" textAnchor="middle" fontSize="8" fontFamily={mono} fontWeight="700" fill={C.core.text} letterSpacing="0.04em">
                Relative
              </text>
            </g>
            
            {/* Top disc - Patient (glass-like chamber) */}
            <g>
              <path d={aiD3.body} fill="rgba(16,185,129,0.06)" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.9" />
              <ellipse
                cx={aiD3.ellipse.cx}
                cy={aiD3.ellipse.cy}
                rx={aiD3.ellipse.rx}
                ry={aiD3.ellipse.ry}
                fill="rgba(255,255,255,0.4)"
                stroke={C.core.stroke}
                strokeWidth="1.5"
                opacity="0.85"
              />
              {/* Pulsing inner glow */}
              <ellipse className="isov3-ai-pulse" cx="340" cy="405" rx="25" ry="12" fill={C.core.stroke} opacity="0.15" />
              <text x="340" y="422" textAnchor="middle" fontSize="8" fontFamily={mono} fontWeight="700" fill={C.core.text} letterSpacing="0.04em">
                Patient
              </text>
            </g>
          </g>
        </g>
        <g className="isov3-g" style={{ "--d": "0.1s" } as React.CSSProperties}>
          <g className="isov3-float-a">

            {/* ── BEHAVIOURAL MODEL (glass chambers with node animation) ── */}
            {[behD1, behD2, behD3].map((d, i) => (
              <g key={`beh-${i}`}>
                <path d={d.body} fill="rgba(16,185,129,0.06)" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.9" />
                <ellipse
                  cx={d.ellipse.cx}
                  cy={d.ellipse.cy}
                  rx={d.ellipse.rx}
                  ry={d.ellipse.ry}
                  fill="rgba(255,255,255,0.4)"
                  stroke={C.core.stroke}
                  strokeWidth="1.5"
                  opacity="0.85"
                />
              </g>
            ))}
            {/* Animated node network */}
            <circle className="isov3-beh-node" cx="540" cy="442" r="2.5" fill={C.core.stroke} opacity="0.4" />
            <circle className="isov3-beh-node" cx="550" cy="437" r="2.5" fill={C.core.stroke} opacity="0.4" style={{animationDelay: "0.5s"} as React.CSSProperties} />
            <circle className="isov3-beh-node" cx="560" cy="442" r="2.5" fill={C.core.stroke} opacity="0.4" style={{animationDelay: "1s"} as React.CSSProperties} />
            <line x1="540" y1="442" x2="550" y2="437" stroke={C.core.stroke} strokeWidth="0.8" opacity="0.25" />
            <line x1="550" y1="437" x2="560" y2="442" stroke={C.core.stroke} strokeWidth="0.8" opacity="0.25" />
          </g>
        </g>
        <g className="isov3-g" style={{ "--d": "0.1s" } as React.CSSProperties}>
          <g className="isov3-float-a">

            {/* ── ASSESSMENT ENGINE (glass chambers with scanning animation) ── */}
            {[assD1, assD2, assD3].map((d, i) => (
              <g key={`ass-${i}`}>
                <path d={d.body} fill="rgba(16,185,129,0.06)" stroke={C.core.stroke} strokeWidth="1.5" opacity="0.9" />
                <ellipse
                  cx={d.ellipse.cx}
                  cy={d.ellipse.cy}
                  rx={d.ellipse.rx}
                  ry={d.ellipse.ry}
                  fill="rgba(255,255,255,0.4)"
                  stroke={C.core.stroke}
                  strokeWidth="1.5"
                  opacity="0.85"
                />
              </g>
            ))}
            {/* Scanning metric bars */}
            <rect className="isov3-ass-scan" x="748" y="447" width="24" height="3" rx="1.5" fill={C.core.stroke} opacity="0.4" />
            <rect className="isov3-ass-scan" x="748" y="437" width="24" height="3" rx="1.5" fill={C.core.stroke} opacity="0.4" style={{animationDelay: "0.8s"} as React.CSSProperties} />
            <rect className="isov3-ass-scan" x="748" y="427" width="24" height="3" rx="1.5" fill={C.core.stroke} opacity="0.4" style={{animationDelay: "1.6s"} as React.CSSProperties} />
          </g>
        </g>

        {/* Overall LIVE RUNTIME CORE label (rendered after discs so it's on top, positioned above) */}
        <rect x="450" y="380" width="200" height="20" rx="4" fill="white" stroke={C.core.stroke} strokeWidth="0.9" />
        <text x="550" y="394" textAnchor="middle" fontSize="10" fontFamily={mono} fontWeight="700" fill={C.core.text} letterSpacing="0.06em">
          LIVE RUNTIME CORE
        </text>

        {/* ── Runtime core labels (rendered AFTER discs, positioned BELOW graphics) ── */}
        <rect x="280" y="496" width="120" height="18" rx="3" fill={C.core.light} stroke={C.core.stroke} strokeWidth="0.8" />
        <text x="340" y="509" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.core.text} letterSpacing="0.05em">
          AI Counterpart
        </text>
        <rect x="480" y="496" width="140" height="18" rx="3" fill={C.core.light} stroke={C.core.stroke} strokeWidth="0.8" />
        <text x="550" y="509" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.core.text} letterSpacing="0.05em">
          Behavioural Model
        </text>
        <rect x="690" y="496" width="140" height="18" rx="3" fill={C.core.light} stroke={C.core.stroke} strokeWidth="0.8" />
        <text x="760" y="509" textAnchor="middle" fontSize="9" fontFamily={mono} fontWeight="600" fill={C.core.text} letterSpacing="0.05em">
          Assessment Engine
        </text>


        {/* ═══════════════════════════════════════════════════
            TRAINEE – actor circle (bottom-left, static)
        ═══════════════════════════════════════════════════ */}
        <g>
          <circle cx="340" cy="645" r="26" fill={C.train.light} stroke={C.train.stroke} strokeWidth="1.4" />
          {/* Person icon */}
          <circle cx="340" cy="638" r="6" fill="none" stroke={C.train.stroke} strokeWidth="1.1" opacity="0.6" />
          <path d="M328,657 Q328,649 340,649 Q352,649 352,657" fill="none" stroke={C.train.stroke} strokeWidth="1.1" opacity="0.6" />
          {/* Microphone hint */}
          <line x1="340" y1="632" x2="340" y2="627" stroke={C.train.stroke} strokeWidth="0.8" opacity="0.4" />
          <path d="M336,627 L344,627" fill="none" stroke={C.train.stroke} strokeWidth="0.8" opacity="0.4" />
          {/* Label below circle, styled like Educator */}
          <rect x="305" y="678" width="70" height="18" rx="3" fill={C.train.light} stroke={C.train.stroke} strokeWidth="0.8" />
          <text x="340" y="691" textAnchor="middle" fontSize="9.5" fontFamily={mono} fontWeight="600" fill={C.train.text} letterSpacing="0.06em">
            Trainee
          </text>
        </g>

        {/* ═══════════════════════════════════════════════════
            REVIEW & FEEDBACK – text label becomes the entity
        ═══════════════════════════════════════════════════ */}
        <g>
          <rect x="660" y="631" width="200" height="28" rx="6" fill={C.rev.light} stroke={C.rev.stroke} strokeWidth="1.4" />
          <text x="760" y="651" textAnchor="middle" fontSize="11" fontFamily={mono} fontWeight="600" fill={C.rev.text} letterSpacing="0.05em">
            Review & Feedback
          </text>
        </g>
      </svg>
    </>
  );
}
