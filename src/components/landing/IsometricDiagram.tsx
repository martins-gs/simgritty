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

/** Quadratic Bezier midpoint at t=0.5. */
function qMid(x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number): [number, number] {
  return [0.25 * x0 + 0.5 * cpx + 0.25 * x1, 0.25 * y0 + 0.5 * cpy + 0.25 * y1];
}

/* ── Colour palette ────────────────────────────────────── */

const C = {
  ai:   { light: "rgba(245,158,11,0.08)", mid: "rgba(245,158,11,0.14)", dark: "rgba(245,158,11,0.22)", stroke: "#f59e0b", text: "#92400e" },
  edu:  { light: "rgba(59,130,246,0.08)", mid: "rgba(59,130,246,0.14)", dark: "rgba(59,130,246,0.22)", stroke: "#3b82f6", text: "#1e40af" },
  train:{ light: "rgba(16,185,129,0.08)", mid: "rgba(16,185,129,0.14)", dark: "rgba(16,185,129,0.22)", stroke: "#10b981", text: "#065f46" },
  assess:{ light: "rgba(139,92,246,0.08)", mid: "rgba(139,92,246,0.14)", dark: "rgba(139,92,246,0.22)", stroke: "#8b5cf6", text: "#5b21b6" },
  gov:  { light: "rgba(13,148,136,0.08)", mid: "rgba(13,148,136,0.14)", dark: "rgba(13,148,136,0.22)", stroke: "#0d9488", text: "#115e59" },
  line: "#d1d5db",
};

/* ── Connection paths ──────────────────────────────────── */

const CONNS = [
  { id: "c1", d: "M248,238 Q370,312 432,368", dot: C.edu.stroke,  label: "Scenario design",   start: [248,238] as const, end: [432,368] as const },
  { id: "c2", d: "M710,120 Q440,168 248,208", dot: C.gov.stroke,  label: "Content policies",  start: [710,120] as const, end: [248,208] as const },
  { id: "c3", d: "M198,502 Q336,438 432,382", dot: C.train.stroke, label: "Live conversation", start: [198,502] as const, end: [432,382] as const },
  { id: "c4", d: "M750,138 Q640,248 522,332", dot: C.gov.stroke,  label: "Escalation ceiling", start: [750,138] as const, end: [522,332] as const },
  { id: "c5", d: "M578,352 Q682,308 748,258", dot: C.ai.stroke,   label: "Classification",    start: [578,352] as const, end: [748,258] as const },
  { id: "c6", d: "M748,288 Q452,442 198,508", dot: C.assess.stroke,label: "Feedback & scores", start: [748,288] as const, end: [198,508] as const },
  { id: "c7", d: "M748,242 Q482,202 250,220", dot: C.assess.stroke,label: "Analytics",         start: [748,242] as const, end: [250,220] as const },
];

const connMids = CONNS.map((c) => {
  const m = c.d.match(/M([\d.]+),([\d.]+)\s*Q([\d.]+),([\d.]+)\s*([\d.]+),([\d.]+)/);
  if (!m) return [0, 0] as [number, number];
  return qMid(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
});

/* ── Decorative diamonds ───────────────────────────────── */

const DIAMONDS = [
  { cx: 348, cy: 158, r: 9,  color: "#ec4899", opacity: 0.3 },
  { cx: 642, cy: 462, r: 11, color: "#ec4899", opacity: 0.25 },
  { cx: 88,  cy: 354, r: 7,  color: "#ec4899", opacity: 0.35 },
  { cx: 885, cy: 405, r: 8,  color: "#ec4899", opacity: 0.28 },
  { cx: 455, cy: 545, r: 10, color: "#ec4899", opacity: 0.22 },
  { cx: 575, cy: 140, r: 7,  color: "#ec4899", opacity: 0.3 },
];

/* ── CSS keyframes ─────────────────────────────────────── */

const STYLES = `
  .iso-float-a { animation: iso-bob 4.0s ease-in-out infinite; }
  .iso-float-b { animation: iso-bob 4.5s ease-in-out infinite; }
  .iso-float-c { animation: iso-bob 3.6s ease-in-out infinite; }
  .iso-float-d { animation: iso-bob 5.0s ease-in-out infinite; }
  .iso-float-e { animation: iso-bob 3.9s ease-in-out infinite; }
  @keyframes iso-bob {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-8px); }
  }

  .iso-dia {
    animation: iso-spin 24s linear infinite;
  }
  @keyframes iso-spin {
    to { transform: rotate(360deg); }
  }

  .iso-g {
    opacity: 0;
  }
  .iso-on .iso-g {
    animation: iso-up 700ms ease-out forwards;
    animation-delay: var(--d);
  }
  @keyframes iso-up {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .iso-ln {
    opacity: 0;
  }
  .iso-on .iso-ln {
    animation: iso-fi 500ms ease-out var(--d) forwards;
  }
  @keyframes iso-fi {
    to { opacity: 1; }
  }

  @media (max-width: 640px) {
    .iso-cl { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    .iso-float-a, .iso-float-b, .iso-float-c,
    .iso-float-d, .iso-float-e, .iso-dia {
      animation: none !important;
    }
    .iso-on .iso-g, .iso-on .iso-ln {
      animation-duration: 0.01ms !important;
      animation-delay: 0ms !important;
    }
  }
`;

/* ── Component ─────────────────────────────────────────── */

export function IsometricDiagram() {
  const ref = useRef<SVGSVGElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setOn(true); obs.disconnect(); } },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* Pre-compute shapes */
  const eduCube = cube(200, 230, 55);
  const trainCube = cube(155, 520, 48);
  const govCube = cube(740, 110, 35);

  /* Wireframe decoration cubes */
  const wf1 = cube(92, 158, 20);
  const wf2 = cube(920, 490, 16);

  /* AI Character: 3 stacked discs */
  const d1 = disc(500, 412, 80, 22);
  const d2 = disc(500, 376, 80, 22);
  const d3 = disc(500, 340, 80, 22);

  const mono = "'SF Mono','Fira Code','Cascadia Code',monospace";

  return (
    <>
      <style>{STYLES}</style>
      <svg
        ref={ref}
        viewBox="0 0 1000 680"
        className={`mx-auto w-full${on ? " iso-on" : ""}`}
        role="img"
        aria-label="Isometric architecture diagram of the PROLOG platform"
        fontFamily="system-ui,-apple-system,sans-serif"
      >
        {/* ── Connection dashed paths + traveling dots ── */}
        {CONNS.map((c, i) => {
          const [mx, my] = connMids[i];
          return (
            <g key={c.id} className="iso-ln" style={{ "--d": `${0.4 + i * 0.08}s` } as React.CSSProperties}>
              <path id={c.id} d={c.d} fill="none" stroke={C.line} strokeWidth="1.2" strokeDasharray="6 4" />
              {/* Endpoint dots */}
              <circle cx={c.start[0]} cy={c.start[1]} r="2.5" fill={c.dot} opacity="0.45" />
              <circle cx={c.end[0]} cy={c.end[1]} r="2.5" fill={c.dot} opacity="0.45" />
              {/* Traveling dots */}
              <circle r="3.5" fill={c.dot} opacity="0.7">
                <animateMotion dur="4s" begin="0s" repeatCount="indefinite"><mpath href={`#${c.id}`} /></animateMotion>
              </circle>
              <circle r="3" fill={c.dot} opacity="0.45">
                <animateMotion dur="4s" begin="-2s" repeatCount="indefinite"><mpath href={`#${c.id}`} /></animateMotion>
              </circle>
              {/* Connection label badge */}
              <g className="iso-cl" transform={`translate(${mx},${my - 12})`}>
                <rect x={-(c.label.length * 3.6 + 8)} y="-9" width={c.label.length * 7.2 + 16} height="18" rx="2" fill="white" stroke="#e5e7eb" strokeWidth="0.6" />
                <text x="0" y="4" textAnchor="middle" fontSize="8.5" fontFamily={mono} fontWeight="500" fill="#6b7280" letterSpacing="0.04em">{c.label}</text>
              </g>
            </g>
          );
        })}

        {/* ── Pulse rings around AI Character ── */}
        {[0, -1, -2].map((begin) => (
          <circle key={begin} cx="500" cy="370" fill="none" stroke={C.ai.stroke} strokeWidth="1">
            <animate attributeName="r" values="85;145" dur="3s" begin={`${begin}s`} repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.3;0" dur="3s" begin={`${begin}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* ── Decorative diamonds (pink accent, like reference) ── */}
        {DIAMONDS.map((d, i) => (
          <g key={`dia-${i}`} className="iso-dia" style={{ transformOrigin: `${d.cx}px ${d.cy}px` }}>
            <path d={diamond(d.cx, d.cy, d.r)} fill={d.color} opacity={d.opacity} />
          </g>
        ))}

        {/* ── Decorative wireframe cubes ── */}
        <g opacity="0.2" fill="none" stroke="#94a3b8" strokeWidth="0.8">
          <path d={wf1.top} /><path d={wf1.right} /><path d={wf1.left} />
        </g>
        <g opacity="0.15" fill="none" stroke="#94a3b8" strokeWidth="0.7">
          <path d={wf2.top} /><path d={wf2.right} /><path d={wf2.left} />
        </g>

        {/* ── AI Character — stacked discs (center) ── */}
        <g className="iso-g" style={{ "--d": "0.1s" } as React.CSSProperties}>
          <g className="iso-float-a">
            {[d1, d2, d3].map((d, i) => (
              <g key={i}>
                <path d={d.body} fill={i === 0 ? C.ai.dark : C.ai.mid} stroke={C.ai.stroke} strokeWidth="1.2" />
                <ellipse cx={d.ellipse.cx} cy={d.ellipse.cy} rx={d.ellipse.rx} ry={d.ellipse.ry} fill={C.ai.light} stroke={C.ai.stroke} strokeWidth="1.2" />
              </g>
            ))}
            {/* Label */}
            <rect x="437" y="445" width="126" height="22" rx="3" fill={C.ai.light} stroke={C.ai.stroke} strokeWidth="0.8" />
            <text x="500" y="460" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.ai.text} letterSpacing="0.06em">AI CHARACTER</text>
          </g>
        </g>

        {/* ── Educator — isometric cube (upper-left) ── */}
        <g className="iso-g" style={{ "--d": "0.2s" } as React.CSSProperties}>
          <g className="iso-float-b">
            <path d={eduCube.left} fill={C.edu.dark} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={eduCube.right} fill={C.edu.mid} stroke={C.edu.stroke} strokeWidth="1.2" />
            <path d={eduCube.top} fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="1.2" />
            {/* Icon: small book lines on the front-right face */}
            <line x1="210" y1="195" x2="240" y2="210" stroke={C.edu.stroke} strokeWidth="0.8" opacity="0.5" />
            <line x1="210" y1="203" x2="240" y2="218" stroke={C.edu.stroke} strokeWidth="0.8" opacity="0.5" />
            <line x1="210" y1="211" x2="235" y2="223" stroke={C.edu.stroke} strokeWidth="0.8" opacity="0.4" />
            {/* Label */}
            <rect x="127" y="275" width="146" height="22" rx="3" fill={C.edu.light} stroke={C.edu.stroke} strokeWidth="0.8" />
            <text x="200" y="290" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.edu.text} letterSpacing="0.06em">SCENARIO BUILDER</text>
          </g>
        </g>

        {/* ── Trainee — isometric cube (lower-left) ── */}
        <g className="iso-g" style={{ "--d": "0.35s" } as React.CSSProperties}>
          <g className="iso-float-c">
            <path d={trainCube.left} fill={C.train.dark} stroke={C.train.stroke} strokeWidth="1.2" />
            <path d={trainCube.right} fill={C.train.mid} stroke={C.train.stroke} strokeWidth="1.2" />
            <path d={trainCube.top} fill={C.train.light} stroke={C.train.stroke} strokeWidth="1.2" />
            {/* Icon: microphone circle on top face */}
            <circle cx="155" cy="487" r="10" fill="none" stroke={C.train.stroke} strokeWidth="1" opacity="0.5" />
            <line x1="155" y1="480" x2="155" y2="494" stroke={C.train.stroke} strokeWidth="1" opacity="0.5" />
            {/* Label */}
            <rect x="112" y="574" width="86" height="22" rx="3" fill={C.train.light} stroke={C.train.stroke} strokeWidth="0.8" />
            <text x="155" y="589" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.train.text} letterSpacing="0.06em">TRAINEE</text>
          </g>
        </g>

        {/* ── Assessment Engine — tilted capsules (right) ── */}
        <g className="iso-g" style={{ "--d": "0.25s" } as React.CSSProperties}>
          <g className="iso-float-d">
            {/* Capsule 1 (filled, darkest) */}
            <g transform="rotate(-30,790,218)">
              <rect x="735" y="207" width="110" height="22" rx="11" fill={C.assess.dark} stroke={C.assess.stroke} strokeWidth="1.2" />
            </g>
            {/* Capsule 2 (filled, lighter) */}
            <g transform="rotate(-30,815,255)">
              <rect x="760" y="244" width="110" height="22" rx="11" fill={C.assess.mid} stroke={C.assess.stroke} strokeWidth="1.2" />
            </g>
            {/* Capsule 3 (outline only) */}
            <g transform="rotate(-30,770,290)">
              <rect x="715" y="279" width="110" height="22" rx="11" fill="none" stroke={C.assess.stroke} strokeWidth="1.2" />
            </g>
            {/* Label */}
            <rect x="720" y="342" width="160" height="22" rx="3" fill={C.assess.light} stroke={C.assess.stroke} strokeWidth="0.8" />
            <text x="800" y="357" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.assess.text} letterSpacing="0.06em">ASSESSMENT ENGINE</text>
          </g>
        </g>

        {/* ── Governance — wireframe dashed cube (upper-right) ── */}
        <g className="iso-g" style={{ "--d": "0.3s" } as React.CSSProperties}>
          <g className="iso-float-e">
            <path d={govCube.left} fill="none" stroke={C.gov.stroke} strokeWidth="1.2" strokeDasharray="4 3" />
            <path d={govCube.right} fill="none" stroke={C.gov.stroke} strokeWidth="1.2" strokeDasharray="4 3" />
            <path d={govCube.top} fill={C.gov.light} stroke={C.gov.stroke} strokeWidth="1.2" strokeDasharray="4 3" />
            {/* Shield icon hint on top face */}
            <path d="M740,82 L740,96 Q740,100 744,102 Q740,100 736,102 Q740,100 740,96Z" fill="none" stroke={C.gov.stroke} strokeWidth="0.8" opacity="0.6" />
            {/* Label */}
            <rect x="690" y="158" width="100" height="22" rx="3" fill={C.gov.light} stroke={C.gov.stroke} strokeWidth="0.8" />
            <text x="740" y="173" textAnchor="middle" fontSize="10.5" fontFamily={mono} fontWeight="600" fill={C.gov.text} letterSpacing="0.06em">GOVERNANCE</text>
          </g>
        </g>
      </svg>
    </>
  );
}
