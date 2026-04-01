import Link from "next/link";
import {
  Mic,
  Activity,
  BarChart3,
  ClipboardList,
  BookOpen,
  MessageSquare,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  Play,
  GitFork,
  Volume2,
  SlidersHorizontal,
  Camera,
  Users,
  Brain,
  FileText,
  Trophy,
  Video,
  Layers,
} from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { HeroTextRotator } from "@/components/landing/HeroTextRotator";
import { ProLogWordmark } from "@/components/ProLogLogo";

/* ------------------------------------------------------------------ */
/*  Shared CTA helper                                                  */
/* ------------------------------------------------------------------ */

function CtaButtons({ user }: { user: unknown }) {
  if (user) {
    return (
      <Link
        href="/dashboard"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Start Here
        <ArrowRight className="h-4 w-4" />
      </Link>
    );
  }
  return (
    <>
      <Link
        href="/auth/signup"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-[14px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Start Here
        <ArrowRight className="h-4 w-4" />
      </Link>
      <Link
        href="/auth/login"
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-border/80 bg-card px-5 text-[14px] font-medium transition-colors hover:bg-accent/60"
      >
        Sign In
      </Link>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Static mock: escalation timeline (matches real EscalationTimeline)  */
/* ------------------------------------------------------------------ */

function EscalationTimelineDemo() {
  // Simulated data: [time-seconds, escalation-level, trust, event-type]
  const data: [number, number, number, string][] = [
    [0, 3, 5, "session_started"],
    [35, 3, 5, "classification_result"],
    [68, 4, 5, "escalation_change"],
    [110, 5, 4, "escalation_change"],
    [155, 6, 3, "escalation_change"],
    [200, 7, 3, "escalation_change"],
    [250, 7, 3, "classification_result"],
    [290, 8, 2, "escalation_change"],
    [340, 7, 3, "de_escalation_change"],
    [395, 6, 3, "de_escalation_change"],
    [440, 5, 4, "de_escalation_change"],
    [490, 5, 4, "classification_result"],
    [535, 4, 5, "de_escalation_change"],
    [580, 4, 5, "classification_result"],
    [625, 3, 6, "de_escalation_change"],
    [665, 3, 6, "classification_result"],
    [700, 2, 7, "de_escalation_change"],
    [720, 2, 7, "session_ended"],
  ];

  const maxTime = 720;
  const ceiling = 8;
  const w = 680;
  const h = 280;
  const pad = { top: 10, bottom: 26, left: 32, right: 56 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  function toX(t: number) { return pad.left + (t / maxTime) * plotW; }
  function toY(level: number) { return pad.top + plotH - (level / 10) * plotH; }

  // Zone bands: [yBottom, yTop, color]
  const zones: [number, number, string][] = [
    [0, 2.5, "#10b981"],
    [2.5, 4.5, "#f59e0b"],
    [4.5, 6.5, "#f97316"],
    [6.5, 8.5, "#ef4444"],
    [8.5, 10, "#991b1b"],
  ];

  const zoneLabels: [number, string, string][] = [
    [1.5, "Calm", "#10b981"],
    [3.5, "Guarded", "#f59e0b"],
    [5.5, "Hostile", "#f97316"],
    [7.5, "Abusive", "#ef4444"],
    [9.5, "Crisis", "#991b1b"],
  ];

  // Step-after path for escalation
  function stepAfterPath(pts: [number, number, number, string][], idx: 1 | 2) {
    let d = "";
    for (let i = 0; i < pts.length; i++) {
      const x = toX(pts[i][0]);
      const y = toY(pts[i][idx]);
      if (i === 0) { d += `M${x.toFixed(1)},${y.toFixed(1)}`; }
      else {
        const prevY = toY(pts[i - 1][idx]);
        d += ` L${x.toFixed(1)},${prevY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}`;
      }
    }
    return d;
  }

  const escLine = stepAfterPath(data, 1);
  const trustLine = stepAfterPath(data, 2);

  // Area fill: step-after path closed to bottom
  const lastPt = data[data.length - 1];
  const escArea = escLine
    + ` L${toX(lastPt[0]).toFixed(1)},${toY(0).toFixed(1)}`
    + ` L${toX(data[0][0]).toFixed(1)},${toY(0).toFixed(1)} Z`;

  function dotColor(type: string) {
    if (type === "escalation_change") return "#ef4444";
    if (type === "de_escalation_change") return "#10b981";
    if (type === "ceiling_reached") return "#991b1b";
    if (type === "session_started" || type === "session_ended") return "#6366f1";
    return "#94a3b8";
  }

  function dotR(type: string) {
    if (type === "ceiling_reached") return 6;
    if (type.includes("escalation")) return 4.5;
    if (type.startsWith("session")) return 3.5;
    return 3;
  }

  // Format time as M:SS
  function fmt(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

  // Summary stats
  const peak = Math.max(...data.map((d) => d[1]));
  const final = data[data.length - 1][1];
  const escCount = data.filter((d) => d[3] === "escalation_change").length;
  const deescCount = data.filter((d) => d[3] === "de_escalation_change").length;

  return (
    <div className="space-y-3">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Peak </span>
          <span className="font-semibold text-red-600">{peak}</span>
        </span>
        <span className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Final </span>
          <span className="font-semibold text-emerald-600">{final}</span>
        </span>
        <span className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Escalations </span>
          <span className="font-semibold text-red-600">{escCount}</span>
        </span>
        <span className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">De-escalations </span>
          <span className="font-semibold text-emerald-600">{deescCount}</span>
        </span>
        <span className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Duration </span>
          <span className="font-semibold">{fmt(maxTime)}</span>
        </span>
      </div>

      {/* Chart */}
      <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
        <div className="min-w-[480px] p-3 sm:p-4">
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="esc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
                <stop offset="40%" stopColor="#f59e0b" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
              </linearGradient>
              <linearGradient id="trust-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Zone background bands */}
            {zones.map(([lo, hi, color]) => (
              <rect
                key={lo}
                x={pad.left}
                y={toY(hi)}
                width={plotW}
                height={toY(lo) - toY(hi)}
                fill={color}
                fillOpacity="0.04"
              />
            ))}

            {/* Grid lines (horizontal, dashed) */}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
              <line
                key={l}
                x1={pad.left}
                x2={pad.left + plotW}
                y1={toY(l)}
                y2={toY(l)}
                stroke="#e2e8f0"
                strokeDasharray="3 6"
              />
            ))}

            {/* Y-axis labels */}
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => (
              <text
                key={l}
                x={pad.left - 8}
                y={toY(l) + 3.5}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="11"
              >
                {l}
              </text>
            ))}

            {/* X-axis labels */}
            {[0, 180, 360, 540, 720].map((s) => (
              <text
                key={s}
                x={toX(s)}
                y={h - 6}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="11"
              >
                {fmt(s)}
              </text>
            ))}

            {/* X-axis line */}
            <line x1={pad.left} x2={pad.left + plotW} y1={toY(0)} y2={toY(0)} stroke="#e2e8f0" />

            {/* Ceiling reference line */}
            <line
              x1={pad.left}
              x2={pad.left + plotW}
              y1={toY(ceiling)}
              y2={toY(ceiling)}
              stroke="#ef4444"
              strokeDasharray="6 4"
              strokeWidth="1.5"
            />
            <text
              x={pad.left + plotW + 4}
              y={toY(ceiling) + 3.5}
              fill="#ef4444"
              fontSize="9"
              fontWeight="600"
            >
              Ceiling {ceiling}
            </text>

            {/* Zone labels (right side) */}
            {zoneLabels.map(([y, label, color]) => (
              <text
                key={label}
                x={pad.left + plotW + 4}
                y={toY(y) + 3}
                fill={color}
                fontSize="9"
                fontWeight="500"
              >
                {label}
              </text>
            ))}

            {/* Trust area fill */}
            {(() => {
              const tArea = trustLine
                + ` L${toX(lastPt[0]).toFixed(1)},${toY(0).toFixed(1)}`
                + ` L${toX(data[0][0]).toFixed(1)},${toY(0).toFixed(1)} Z`;
              return <path d={tArea} fill="url(#trust-fill)" />;
            })()}

            {/* Trust line (dashed) */}
            <path
              d={trustLine}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />

            {/* Escalation area fill */}
            <path d={escArea} fill="url(#esc-fill)" />

            {/* Escalation line (step-after, solid) */}
            <path d={escLine} fill="none" stroke="#334155" strokeWidth="2.5" />

            {/* Event dots */}
            {data.map((pt, i) => {
              const cx = toX(pt[0]);
              const cy = toY(pt[1]);
              const color = dotColor(pt[3]);
              const r = dotR(pt[3]);
              return (
                <g key={i}>
                  {/* Halo */}
                  <circle cx={cx} cy={cy} r={r + 3} fill={color} fillOpacity="0.15" />
                  {/* Dot */}
                  <circle cx={cx} cy={cy} r={r} fill="white" stroke={color} strokeWidth="2.5" />
                  {/* Direction arrow */}
                  {pt[3] === "escalation_change" && (
                    <polygon
                      points={`${cx},${cy + r + 3} ${cx - 3},${cy + r + 8} ${cx + 3},${cy + r + 8}`}
                      fill="#ef4444"
                      opacity="0.6"
                    />
                  )}
                  {pt[3] === "de_escalation_change" && (
                    <polygon
                      points={`${cx},${cy + r + 8} ${cx - 3},${cy + r + 3} ${cx + 3},${cy + r + 3}`}
                      fill="#10b981"
                      opacity="0.6"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5">
          <svg width="20" height="4" className="shrink-0"><line x1="0" y1="2" x2="20" y2="2" stroke="#334155" strokeWidth="2.5" /></svg>
          Escalation level
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5">
          <svg width="20" height="4" className="shrink-0"><line x1="0" y1="2" x2="20" y2="2" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Trust
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5">
          <svg width="12" height="12" className="shrink-0"><circle cx="6" cy="6" r="5" fill="white" stroke="#ef4444" strokeWidth="2" /></svg>
          Escalation event
        </span>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5">
          <svg width="12" height="12" className="shrink-0"><circle cx="6" cy="6" r="5" fill="white" stroke="#10b981" strokeWidth="2" /></svg>
          De-escalation event
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Static mock: transcript with playback & fork                       */
/* ------------------------------------------------------------------ */

function TranscriptDemo() {
  const turns = [
    {
      speaker: "Patient",
      badge: "bg-muted text-muted-foreground",
      text: "I've been waiting three hours and nobody has told me anything. This is completely unacceptable!",
      esc: { dir: "up", label: "Level 5 \u2192 6" },
    },
    {
      speaker: "Trainee",
      badge: "bg-primary/10 text-primary",
      text: "I can hear how frustrated you are, and I'm sorry about the wait. Let me find out what's happening with your mother's results right now.",
      technique: "Acknowledgement + commitment",
      esc: { dir: "down", label: "Level 6 \u2192 5" },
    },
    {
      speaker: "Patient",
      badge: "bg-muted text-muted-foreground",
      text: "You'd better, because if someone doesn't come and speak to me in the next five minutes I'm making a formal complaint.",
      esc: { dir: "neutral", label: "Level 5" },
    },
    {
      speaker: "Trainee",
      badge: "bg-primary/10 text-primary",
      text: "That's absolutely your right. I want to make sure you have the information you need. I'm going to check the system now and come straight back to you.",
      technique: "Validation + concrete action",
      esc: { dir: "down", label: "Level 5 \u2192 4" },
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 sm:px-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Example Transcript
        </p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          Full audio available
        </div>
      </div>
      <div className="divide-y divide-border/40">
        {turns.map((t, i) => (
          <div key={i} className="flex gap-3 px-4 py-3 sm:px-5">
            <div className="pt-0.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                <Play className="h-3 w-3" />
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${t.badge}`}>
                  {t.speaker}
                </span>
                {t.technique && (
                  <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    {t.technique}
                  </span>
                )}
                <span
                  className={`ml-auto text-[11px] font-medium ${
                    t.esc.dir === "up"
                      ? "text-destructive"
                      : t.esc.dir === "down"
                        ? "text-emerald-600"
                        : "text-muted-foreground"
                  }`}
                >
                  {t.esc.dir === "up" ? "\u2191" : t.esc.dir === "down" ? "\u2193" : "="}{" "}
                  {t.esc.label}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-foreground/90">
                {t.text}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-2.5 sm:px-5">
        <p className="text-[12px] text-muted-foreground">
          Click any turn to play back the original audio recording
        </p>
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <GitFork className="h-3 w-3" />
          Restart from turn
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Static mock: configuration sliders                                 */
/* ------------------------------------------------------------------ */

function SliderMock({ label, value, low, high }: { label: string; value: number; low: string; high: string }) {
  const pct = (value / 10) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[12px] text-muted-foreground">{value}/10</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-primary bg-card"
          style={{ left: `calc(${pct}% - 8px)` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function ConfigurationDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Emotional Baseline */}
      <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-primary">
          Emotional Baseline
        </p>
        <div className="space-y-4">
          <SliderMock label="Hostility" value={3} low="Friendly" high="Hostile" />
          <SliderMock label="Frustration" value={5} low="Patient" high="Extremely frustrated" />
          <SliderMock label="Impatience" value={5} low="Patient" high="Demands immediacy" />
          <SliderMock label="Trust in Clinician" value={5} low="Deep distrust" high="Trusting" />
        </div>
      </div>

      {/* Behavioural Style */}
      <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-primary">
          Behavioural Style
        </p>
        <div className="space-y-4">
          <SliderMock label="Willingness to Listen" value={5} low="Closed off" high="Very receptive" />
          <SliderMock label="Sarcasm" value={3} low="Sincere" high="Heavily sarcastic" />
          <SliderMock label="Volatility" value={3} low="Stable" high="Highly volatile" />
          <SliderMock label="Boundary Respect" value={5} low="Boundary-violating" high="Respectful" />
        </div>
      </div>

      {/* Voice & Cognitive */}
      <div className="space-y-4 sm:col-span-2 lg:col-span-1">
        <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-primary">
            Voice Settings
          </p>
          <div className="space-y-4">
            <SliderMock label="Speaking Rate" value={5} low="Slow" high="Fast" />
            <SliderMock label="Expressiveness" value={5} low="Flat" high="Highly expressive" />
            <SliderMock label="Anger Expression" value={3} low="Calm" high="Intense" />
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-primary">
            Bias Categories
          </p>
          <div className="flex flex-wrap gap-1.5">
            {["Gender bias", "Racial bias", "Age bias", "Accent bias", "Class/status bias", "Role/status bias"].map(
              (cat, i) => (
                <span
                  key={cat}
                  className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${
                    i < 4
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground"
                  }`}
                >
                  {cat}
                </span>
              ),
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            4 active. Bias intensity slider controls the strength.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Landing Page                                                       */
/* ================================================================== */

export default async function LandingPage() {
  const user = await getUser();

  return (
    <div className="min-h-screen bg-background">
      {/* ── Nav ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center">
            <ProLogWordmark className="text-[15px]" subtitle iconSize={26} />
          </Link>
          <div className="flex items-center gap-2">
            {user ? (
              <Link
                href="/dashboard"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Start Here
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Start Here
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.03] to-transparent" />
        <div className="relative mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28 md:py-36">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-3 text-[13px] font-medium uppercase tracking-wide text-primary">
              AI-Powered Training for Health, Care &amp; Social Work
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Build confidence for
              <br />
              <HeroTextRotator />
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
              Realistic voice simulations that let healthcare professionals,
              care workers, and social workers rehearse difficult conversations
              with patients, relatives, and staff, using AI speech models that
              adapt to every word you say — on any device with a browser and
              microphone.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <CtaButtons user={user} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Mobile-First Advantage ──────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <p className="mb-2 text-center text-[13px] font-medium uppercase tracking-wide text-primary">
              Mobile-First, Not Headset-Dependent
            </p>
            <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">
              Immersive training without the hardware overhead
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
              Extended reality headsets are expensive to procure, difficult to
              deploy at scale, and costly to maintain. Every headset needs
              charging, cleaning, software updates, and technical support —
              and your training capacity is limited by how many units you own
              as well as the time and costs of developing immersive content.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
              PROLOG runs on the devices your staff already carry. A mobile
              phone, tablet, or laptop with a browser and microphone is all it
              takes. This makes it significantly cheaper to produce, deploy,
              and maintain — while delivering a more meaningful level of
              engagement, because trainees practise with their own voice in
              natural spoken conversation rather than navigating a virtual
              environment with controllers.
            </p>

            {/* Comparison table */}
            <div className="mt-8 overflow-hidden rounded-xl border border-border/60">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground" />
                    <th className="px-4 py-2.5 text-left font-semibold">PROLOG</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">XR Headsets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {([
                    ["Hardware required", "Any device with a browser", "Dedicated headset per trainee"],
                    ["Hardware cost", "None", "Significant per-unit investment"],
                    ["Content creation", "Minimal — educators configure scenarios in minutes", "Expensive 3D environments, voice actors, scripting"],
                    ["Deployment", "Share a link", "Provision, configure, distribute"],
                    ["Ongoing maintenance", "None", "Charging, cleaning, repairs, updates"],
                    ["Scalability", "Unlimited — scales with your cohort", "Limited by inventory"],
                    ["Engagement model", "Natural voice conversation", "Fixed multiple choice options"],
                  ] as const).map(([label, sg, xr]) => (
                    <tr key={label} className="bg-card">
                      <td className="px-4 py-2 font-medium text-muted-foreground">{label}</td>
                      <td className="px-4 py-2">{sg}</td>
                      <td className="px-4 py-2 text-muted-foreground">{xr}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ── Why PROLOG ───────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Safe, realistic practice for high-stakes conversations
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
              Handling difficult conversations and building skills like
              de-escalation takes practice, not just theory. PROLOG gives
              healthcare staff, care workers, and social workers a safe space
              to practise with AI-powered patients, relatives, and colleagues
              who respond dynamically to tone, technique, and timing — without
              risk to real people.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <h3 className="text-[14px] font-semibold">Zero-Risk Environment</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Make mistakes, try new approaches, and build confidence without
                consequences for patients, relatives, or colleagues.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <MessageSquare className="h-5 w-5 text-amber-600" />
              </div>
              <h3 className="text-[14px] font-semibold">Real Conversation, Not Scripts</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                AI characters respond to what you actually say. Every session
                unfolds differently based on your choices.
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <RefreshCw className="h-5 w-5 text-blue-600" />
              </div>
              <h3 className="text-[14px] font-semibold">Practise and Repeat</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Replay sessions from any point, fork the conversation to try a
                different technique, and track improvement over time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-12 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              Features
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Everything you need for effective training
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <BookOpen className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Scenario Builder</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Educators create custom scenarios with 15 personality dials,
                configurable voice settings, bias categories, escalation rules,
                and clinical milestones — or start from archetype presets.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Mic className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Real-Time Voice Simulation</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Speak naturally with AI patients, relatives, and staff through your
                microphone. Voice tone, pacing, and emotional intensity all
                shift dynamically as the conversation evolves.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <BarChart3 className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Evidence-Based Scoring</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Performance is measured across four dimensions — composure,
                de-escalation effectiveness, clinical task maintenance, and
                support seeking — each backed by turn-level evidence.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <ClipboardList className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Detailed Post-Session Review</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Review full transcripts with audio playback, an escalation
                timeline, key moment highlights, and AI-generated suggestions
                for what to try next time.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <ShieldCheck className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Governance Controls</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Organisation admins set escalation ceilings, session time
                limits, content policies, and consent gates to keep training
                safe and appropriate.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Activity className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Dynamic Escalation Engine</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                A 10-level state machine tracks escalation, trust, anger, and
                frustration. Your communication technique directly influences
                whether the situation improves or worsens.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Escalation Timeline Demo ────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              Session Outputs
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              See exactly how the conversation unfolded
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
              Every session produces a rich set of outputs: an escalation
              timeline, a full transcript with per-turn audio playback, and
              the option to fork and restart from any point.
            </p>
          </div>
          <div className="space-y-6">
            <EscalationTimelineDemo />
            <TranscriptDemo />
          </div>
        </div>
      </section>

      {/* ── Configuration Demo ──────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              Scenario Configuration
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Fine-tune every aspect of the AI character
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
              Educators shape the patient or relative's personality across
              emotional, behavioural, cognitive, and vocal dimensions. Toggle
              specific bias categories and control their intensity to create
              precisely the training challenge needed.
            </p>
          </div>
          <ConfigurationDemo />
        </div>
      </section>

      {/* ── How It Works ────────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-12 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              How It Works
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              From scenario to skill in five steps
            </h2>
          </div>
          <div className="mx-auto max-w-2xl">
            <ol className="relative space-y-0">
              {[
                {
                  step: "1",
                  title: "Choose a scenario",
                  desc: "Browse published scenarios on your dashboard, each designed around a specific clinical setting and patient or relative personality. Educators can also create custom scenarios from scratch.",
                },
                {
                  step: "2",
                  title: "Read the briefing",
                  desc: "Review your role, the situation, learning objectives, and any content warnings before the simulation begins.",
                },
                {
                  step: "3",
                  title: "Speak with the AI patient or relative",
                  desc: "A live voice conversation begins. The character reacts in real time to your words, tone, and approach. An escalation meter shows how the situation is developing.",
                },
                {
                  step: "4",
                  title: "Apply your techniques",
                  desc: "Use de-escalation strategies to bring the situation under control. If needed, call in the AI clinician for support — knowing when to ask for help is part of the assessment.",
                },
                {
                  step: "5",
                  title: "Review your performance",
                  desc: "Get scored across four dimensions with turn-level evidence. Replay the full audio recording, study the escalation timeline, and fork from any turn to try a different approach.",
                },
              ].map((item, i) => (
                <li key={item.step} className="relative flex gap-4 pb-8 last:pb-0">
                  {i < 4 && (
                    <div className="absolute left-[15px] top-9 h-[calc(100%-20px)] w-px bg-border" />
                  )}
                  <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground">
                    {item.step}
                  </div>
                  <div className="pt-0.5">
                    <h3 className="text-[14px] font-semibold">{item.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      {item.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Who It's For ────────────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-12 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              Built For Health, Care &amp; Social Work
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Designed for the people who need it most
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { role: "Nurses & Midwives", desc: "Practise managing distressed relatives and aggressive patients on wards." },
              { role: "Doctors & Registrars", desc: "Build confidence delivering difficult news and handling confrontation." },
              { role: "Care Workers", desc: "Rehearse responses to challenging behaviour in residential and domiciliary settings." },
              { role: "Social Workers", desc: "Prepare for high-conflict home visits, safeguarding conversations, and family mediation." },
              { role: "GP Receptionists", desc: "Rehearse front-desk encounters with frustrated or demanding patients and relatives." },
              { role: "Educators & Trainers", desc: "Create targeted scenarios, observe sessions, and provide turn-level feedback and notes." },
            ].map((item) => (
              <div key={item.role} className="rounded-xl border border-border/60 bg-background p-4">
                <h3 className="text-[14px] font-semibold">{item.role}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Auditability & Assessment ───────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl">
            <div className="mb-8 text-center">
              <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
                Auditable & Transparent
              </p>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                Every session is fully recorded and reviewable
              </h2>
            </div>
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Because the entire conversation is audio-recorded and
              transcribed, every session is auditable. Trainees, educators,
              and administrators can review exactly what was said, how the AI
              responded, and how scores were assigned. If a score feels
              inaccurate, the evidence trail is there to support a dispute.
            </p>
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <p className="text-[14px] font-semibold text-amber-900">
                A training tool, not a replacement for formal assessment
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-amber-800">
                AI scoring is probabilistic by nature. PROLOG is designed
                to help trainees build adaptable muscle memory for difficult
                conversations — preparation for an OSCE or similar structured
                assessment, not a substitute for one. Think of it as a
                practice ground that accelerates readiness, with enough
                rigour to be useful and enough transparency to be trusted.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Outcomes ────────────────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl">
            <div className="mb-10 text-center">
              <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
                Outcomes
              </p>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                What your team gains
              </h2>
            </div>
            <div className="space-y-3">
              {[
                "Confidence handling aggression, distress, and discriminatory behaviour from patients, relatives, and colleagues",
                "Adaptable muscle memory for difficult conversations, built through repeated practice",
                "Objective, evidence-based feedback on communication technique across four dimensions",
                "Ability to replay audio, fork sessions, and test alternative approaches from any point",
                "Educator oversight with session-level and turn-level notes",
                "Measurable progress across composure, de-escalation, and support seeking",
                "Reduced risk of workplace incidents through better-prepared staff",
                "Significantly lower cost than XR-based training, with no hardware to procure or maintain",
              ].map((text) => (
                <div key={text} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <p className="text-[14px] leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Future Updates ──────────────────────────────────────── */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-primary">
              Roadmap
            </p>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Future updates
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-[14px] leading-relaxed text-muted-foreground">
              The current simulation is designed around microaggressions, but
              in reality almost any type of conversational scenario could be
              implemented. Here is what is on the horizon.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Layers className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Additional Scenario Domains</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Update the scenario modelling and scoring method to support any
                conversation type — extending PROLOG beyond de-escalation into
                broader communication skills training.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Camera className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Trainee Video & Body Language Feedback</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Capture video or snapshots of the trainee during the session
                and provide AI-generated feedback on facial expression and
                body language while they are listening and speaking.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Staff-to-Staff Scenarios</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Extend the AI counterpart so that it can simulate
                microaggressions from other staff members rather than only
                patients and relatives, reflecting the full range of workplace
                interactions.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Brain className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Educator-Editable AI Prompts & Knowledge Bases</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Enhance the settings page so educators can directly edit the
                AI prompts used for the escalation engine and scoring engine,
                and upload associated knowledge bases for specific domain
                scenarios.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Higher-Quality Transcription</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Use a higher-quality transcription model to allay concerns
                over potential divergence between what the trainee said and
                what is presented on screen — even though the AI already
                handles such divergence gracefully.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Trophy className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Anonymised Cohort Scoreboard</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Create an anonymised scoreboard so trainees know where they
                are scoring relative to their cohort, providing motivation
                and context for improvement.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Video className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">AI-Generated Visual Immersion</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Present small AI-generated video clips or images as a way of
                immersing the trainee in the scenario — adding visual context
                to the voice-first experience.
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <SlidersHorizontal className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-[14px] font-semibold">Granular Microaggression Controls</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                Give educators fine-grained control over the specific types of
                microaggression exhibited by the AI patient, relative, or
                staff member during a scenario.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────── */}
      <section className="border-t border-border/60 bg-card">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-lg text-center">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Ready to start training?
            </h2>
            <p className="mt-3 text-[14px] text-muted-foreground">
              PROLOG is provided free of charge as an in-house training
              tool. Create an account in seconds and start practising.
            </p>
            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <CtaButtons user={user} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 sm:px-6">
          <ProLogWordmark className="text-[13px]" subtitle iconSize={20} />
          <p className="text-[12px] text-muted-foreground">
            Built for NHS Scotland and HSCP staff
          </p>
        </div>
      </footer>
    </div>
  );
}
