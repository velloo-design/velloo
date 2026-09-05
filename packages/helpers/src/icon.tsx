// Velloo-owned lucide icon rendered as an inline <svg> from build-time-extracted
// node data (icon-data.ts, see scripts/generate-icon-data.ts) — no lucide-react
// at runtime, so bundles carry path data instead of ~2k component exports.
// The Velloo manifest still carries an "icon" control with the full lucide name
// set, and codegen lowers <Icon name="X"/> to `<X />` from "lucide-react" so the
// emitted code has zero Velloo runtime dependencies.

import { pascalizeIconName } from "@velloo/schema/icon-name";
import * as React from "react";
import { cn } from "./cn.ts";
import { ICON_ALIASES, ICON_NODES, type IconNode, LUCIDE_SVG_ATTRIBUTES } from "./icon-data.ts";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide icon name — PascalCase ("ChevronRight") or kebab-case ("chevron-right"). */
  name: string;
  /** Pixel size — the svg's width/height. */
  size?: number;
  /** Stroke width. */
  strokeWidth?: number;
}

function lookup(name: string): IconNode | undefined {
  const trimmed = name.trim();
  const direct = ICON_NODES[trimmed] ?? ICON_NODES[ICON_ALIASES[trimmed] ?? ""];
  if (direct) return direct;
  const viaPascal = ICON_ALIASES[pascalizeIconName(trimmed)];
  return viaPascal === undefined ? undefined : ICON_NODES[viaPascal];
}

const FALLBACK = lookup("HelpCircle");

export function Icon({ name, className, size = 16, strokeWidth = 2, ...props }: IconProps) {
  const hit = lookup(name);
  const node = hit ?? FALLBACK;
  if (!node) return null;
  const tint = hit ? className : cn("text-[var(--color-fg-muted)]", className);
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative by default, like lucide's own components — callers pass aria-* through props.
    <svg
      {...LUCIDE_SVG_ATTRIBUTES}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={tint}
      {...props}
    >
      {node.map(([tag, attrs], i) =>
        // Node data is static per icon name, so the index key is stable.
        React.createElement(tag, { ...attrs, key: i }),
      )}
    </svg>
  );
}
