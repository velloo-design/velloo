// Velloo-owned wrapper around lucide-react. The Velloo manifest carries an
// "icon" control with the full lucide name set; codegen lowers <Icon name="X"/>
// to `<X />` from "lucide-react" so the emitted code has zero Velloo runtime
// dependencies.
import * as Lucide from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Lucide icon name (PascalCase), e.g. "Heart", "ChevronRight". */
  name: string;
  /** Pixel size — passed through to lucide. */
  size?: number;
  /** Stroke width — passed through to lucide. */
  strokeWidth?: number;
}

const REGISTRY = Lucide as unknown as Record<string, React.ComponentType<Lucide.LucideProps>>;

export function Icon({ name, className, size = 16, strokeWidth = 2, ...props }: IconProps) {
  const Resolved = REGISTRY[name] ?? REGISTRY.HelpCircle;
  if (!Resolved) return null;
  const tint = REGISTRY[name] ? className : cn("text-[var(--color-fg-muted)]", className);
  return <Resolved className={tint} size={size} strokeWidth={strokeWidth} {...props} />;
}
