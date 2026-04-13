import type { CSSProperties } from "react";

export const insightHeroClass =
  "relative isolate overflow-hidden rounded-[28px] border border-slate-800/90 text-white";

export const insightHeroStyle: CSSProperties = {
  background:
    "radial-gradient(circle at top left, rgba(191, 219, 254, 0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(248, 167, 87, 0.24), transparent 32%), linear-gradient(135deg, #0d1427 0%, #141d35 48%, #1c2945 100%)",
  boxShadow: "0 30px 60px -36px rgba(15, 23, 42, 0.78)",
};

export const reviewHeroStyle: CSSProperties = {
  background: "#121b31",
  boxShadow: "0 30px 60px -36px rgba(15, 23, 42, 0.72)",
};

export const insightBadgeClass =
  "inline-flex items-center rounded-full border border-white/12 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90";

export const insightStatClass =
  "rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-sm";

export const insightGlassCardClass =
  "rounded-[22px] border border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm";

export const heatmapShellClass =
  "rounded-[28px] border border-slate-200/90";

export const heatmapShellStyle: CSSProperties = {
  background: "#f7f9fc",
  boxShadow: "0 22px 42px -30px rgba(15, 23, 42, 0.18)",
};

export const heatmapSoftCardClass =
  "rounded-[20px] border border-slate-200/90";

export const heatmapSoftCardStyle: CSSProperties = {
  background: "#eef3f7",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.68)",
};

export const heatmapWarmCardClass =
  "rounded-[20px] border border-[#e7be8f]";

export const heatmapWarmCardStyle: CSSProperties = {
  background: "#eed8bb",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.42)",
};

export const heatmapSageCardClass =
  "rounded-[20px] border border-[#c4d7c8]";

export const heatmapSageCardStyle: CSSProperties = {
  background: "#e3eee5",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.56)",
};

export const heatmapPlumCardClass =
  "rounded-[20px] border border-[#d7cce8]";

export const heatmapPlumCardStyle: CSSProperties = {
  background: "#ede7f4",
  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.54)",
};

export const heatmapPlainCardClass =
  "rounded-[20px] border border-slate-200/90 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]";
