/**
 * Velloo logo — two interlinked rounded frames ("Design + Code, interlinked").
 * Coral frame weaves over amber at the top crossing, under at the bottom.
 * Flat duotone (amber #FFAB1F + coral #FF6F4D); renders cleanly at 16px (favicon)
 * through hero sizes. See velloo-brand/brand/2-guidelines for the full spec.
 */
interface Props {
  className?: string | undefined;
  size?: number | undefined;
}

function Logo({ className, size = 24 }: Props) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Velloo"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Velloo</title>
      <defs>
        <clipPath id="velloo-weave">
          <rect x="52" y="30" width="38" height="35" />
        </clipPath>
      </defs>
      <rect
        x="21"
        y="21"
        width="58"
        height="58"
        rx="20"
        stroke="#FF6F4D"
        strokeWidth="11"
        strokeLinejoin="round"
      />
      <rect
        x="41"
        y="41"
        width="58"
        height="58"
        rx="20"
        stroke="#FFAB1F"
        strokeWidth="11"
        strokeLinejoin="round"
      />
      <rect
        x="21"
        y="21"
        width="58"
        height="58"
        rx="20"
        stroke="#FF6F4D"
        strokeWidth="11"
        strokeLinejoin="round"
        clipPath="url(#velloo-weave)"
      />
    </svg>
  );
}

/**
 * Full lockup: the mark + the "velloo" wordmark (lowercase, Poppins, the oo as
 * amber + coral dots). Requires the Poppins font to be loaded in the app
 * (falls back to ui-sans-serif). `color` flows to the "vell" letters.
 */
export function LogoLockup({
  className,
  fontSize = 26,
}: {
  className?: string;
  fontSize?: number;
}) {
  const dot = Math.round(fontSize * 0.57);
  const gap = Math.max(1, Math.round(fontSize * 0.022));
  const markSize = Math.round(fontSize * 1.55);
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(markSize * 0.28) }}
    >
      <Logo size={markSize} />
      <span
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          fontFamily: '"Poppins", ui-sans-serif, system-ui, sans-serif',
          fontWeight: 700,
          fontSize,
          letterSpacing: "-0.06em",
          lineHeight: 1,
        }}
      >
        vell
        <span
          style={{
            width: dot,
            height: dot,
            borderRadius: 9999,
            background: "#FFAB1F",
            marginLeft: gap,
            display: "inline-block",
          }}
        />
        <span
          style={{
            width: dot,
            height: dot,
            borderRadius: 9999,
            background: "#FF6F4D",
            marginLeft: gap,
            display: "inline-block",
          }}
        />
      </span>
    </span>
  );
}
