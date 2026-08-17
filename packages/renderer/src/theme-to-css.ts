import type { Colors, Theme } from "@velloo/schema";

/**
 * Map theme tokens onto the shadcn CSS-variable convention so the
 * pre-compiled snapshot stylesheet picks up the design's colors, typography,
 * and radius at render time.
 */
const COLOR_TOKEN_MAP: Record<string, string | [string, string]> = {
  background: "--color-background",
  foreground: "--color-foreground",
  border: "--color-border",
  input: "--color-input",
  ring: "--color-ring",
  // Pair tokens carry { DEFAULT, foreground }.
  primary: ["--color-primary", "--color-primary-foreground"],
  secondary: ["--color-secondary", "--color-secondary-foreground"],
  muted: ["--color-muted", "--color-muted-foreground"],
  accent: ["--color-accent", "--color-accent-foreground"],
  destructive: ["--color-destructive", "--color-destructive-foreground"],
  card: ["--color-card", "--color-card-foreground"],
  popover: ["--color-popover", "--color-popover-foreground"],
};

function emit(varName: string, value: string | number | undefined, lines: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    lines.push(`  ${varName}: ${value};`);
  }
}

function emitColorBlock(colors: Partial<Colors>, lines: string[]): void {
  for (const [token, target] of Object.entries(COLOR_TOKEN_MAP)) {
    const value = colors[token as keyof Colors];
    if (value === undefined) continue;
    if (Array.isArray(target)) {
      const [defaultVar, foregroundVar] = target;
      if (typeof value === "object") {
        emit(defaultVar, value.DEFAULT, lines);
        emit(foregroundVar, value.foreground, lines);
      } else {
        // Scalar value for a pair token — apply to DEFAULT only.
        emit(defaultVar, value, lines);
      }
    } else if (typeof value === "string") {
      emit(target, value, lines);
    }
  }
}

export function themeToCss(theme: Theme): string {
  const lines: string[] = [":root {"];
  emitColorBlock(theme.colors, lines);

  const fontFamily = theme.typography.fontFamily;
  if (fontFamily) {
    // Every role becomes a --font-<role> token; Tailwind v4 then owns
    // the matching `font-<role>` utility (compiled by the JIT, which
    // mirrors these tokens into its @theme — see tailwind-jit.ts).
    for (const [role, stack] of Object.entries(fontFamily)) {
      emit(`--font-${role}`, stack, lines);
    }
  }

  // Radius: a single --radius pulled from radius.md (or radius.lg / .sm as fallback).
  const radiusValue = theme.radius.md ?? theme.radius.lg ?? theme.radius.sm;
  if (radiusValue !== undefined) {
    const formatted = typeof radiusValue === "number" ? `${radiusValue}px` : radiusValue;
    lines.push(`  --radius: ${formatted};`);
  }

  lines.push("}");

  // Dark-mode overrides — gated on a `.dark` ancestor so the canvas can flip
  // a single class to preview both modes without re-rendering.
  if (theme.colorsDark) {
    lines.push("");
    lines.push(".dark {");
    emitColorBlock(theme.colorsDark, lines);
    lines.push("}");
  }

  return lines.join("\n");
}
