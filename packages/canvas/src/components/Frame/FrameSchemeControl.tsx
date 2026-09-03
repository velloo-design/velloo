import type { FrameScheme } from "@velloo/schema";
import { Moon, Sun, SunMoon } from "lucide-react";

interface FrameSchemeControlProps {
  frameLabel: string;
  scheme?: FrameScheme;
  canvasDefault: FrameScheme;
  onChange: (scheme: FrameScheme | null) => void;
}

const baseClass =
  "h-5 min-w-5 px-1 grid place-items-center rounded-sm border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const idleClass = "border-transparent text-muted-foreground hover:border-border hover:bg-card";
const activeClass = "border-primary/40 bg-primary/10 text-primary";

/** Three explicit states: follow the canvas default, pinned light, or pinned dark. */
export function FrameSchemeControl({
  frameLabel,
  scheme,
  canvasDefault,
  onChange,
}: FrameSchemeControlProps) {
  return (
    <fieldset
      aria-label={`Color scheme for ${frameLabel}`}
      className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background/70 p-0.5"
    >
      <button
        type="button"
        aria-label={`Follow canvas default for ${frameLabel} (currently ${canvasDefault})`}
        aria-pressed={scheme === undefined}
        title={`Follow canvas default (currently ${canvasDefault})`}
        className={`${baseClass} ${scheme === undefined ? activeClass : idleClass}`}
        onClick={() => onChange(null)}
      >
        <SunMoon size={11} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={`Pin ${frameLabel} to light mode`}
        aria-pressed={scheme === "light"}
        title="Pin this frame to light"
        className={`${baseClass} ${scheme === "light" ? activeClass : idleClass}`}
        onClick={() => onChange("light")}
      >
        <Sun size={11} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={`Pin ${frameLabel} to dark mode`}
        aria-pressed={scheme === "dark"}
        title="Pin this frame to dark"
        className={`${baseClass} ${scheme === "dark" ? activeClass : idleClass}`}
        onClick={() => onChange("dark")}
      >
        <Moon size={11} strokeWidth={2} />
      </button>
    </fieldset>
  );
}
