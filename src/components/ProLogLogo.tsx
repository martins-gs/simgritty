/**
 * PROLOG logo — two overlapping speech bubbles (blue + green)
 * with a white medical cross at the intersection.
 */

interface ProLogLogoProps {
  /** Outer height in pixels. Width scales proportionally. */
  size?: number;
  className?: string;
}

export function ProLogIcon({ size = 32, className }: ProLogLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Blue speech bubble (left) */}
      <path
        d="M50 15C30 15 14 29 14 47c0 10 5 19 13 25l-4 13 14-8c4 1.5 8 2 12 2"
        fill="#005eb8"
      />
      {/* Green speech bubble (right) */}
      <path
        d="M50 15c20 0 36 14 36 32 0 18-16 32-36 32-4 0-8-.5-12-2l-14 8 4-13c-8-6-13-15-13-25"
        fill="#007f3b"
      />
      {/* Cross */}
      <rect x="43" y="33" width="14" height="30" rx="2" fill="white" />
      <rect x="35" y="41" width="30" height="14" rx="2" fill="white" />
    </svg>
  );
}

interface ProLogWordmarkProps {
  className?: string;
  subtitle?: boolean;
  /** Icon size in pixels. Set to 0 to hide the icon. */
  iconSize?: number;
}

export function ProLogWordmark({ className, subtitle, iconSize = 20 }: ProLogWordmarkProps) {
  return (
    <span className={`inline-flex flex-col ${className ?? ""}`}>
      <span className="inline-flex items-center" style={{ gap: "0.35em" }}>
        {iconSize > 0 && <ProLogIcon size={iconSize} />}
        <span style={{ letterSpacing: "0.12em", fontFamily: "var(--font-logo)", fontWeight: 200 }}>
          <span style={{ color: "#003087" }}>PRO</span>
          <span style={{ color: "#007f3b" }}>LOG</span>
        </span>
      </span>
      {subtitle && (
        <span
          className="font-medium uppercase text-muted-foreground"
          style={{ fontSize: "7px", letterSpacing: "0.12em" }}
        >
          Conversational confidence
        </span>
      )}
    </span>
  );
}
