import type { Theme } from "@velloo/schema";

/**
 * Map our theme color tokens onto the shadcn CSS-variable convention so the
 * pre-compiled snapshot stylesheet picks up the design's colors. Other token
 * groups (typography, spacing, radius) round-trip through the snapshot
 * defaults until the theme editor lands in Sprint 5.
 */
const COLOR_TOKEN_MAP: Record<string, string | string[]> = {
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

function emit(varName: string, value: unknown, lines: string[]): void {
  if (typeof value === "string" || typeof value === "number") {
    lines.push(`  ${varName}: ${value};`);
  }
}

export function themeToCss(theme: Theme): string {
  const lines: string[] = [":root {"];
  const colors = theme.colors as Record<string, unknown>;

  for (const [token, target] of Object.entries(COLOR_TOKEN_MAP)) {
    const value = colors[token];
    if (value === undefined) continue;

    if (Array.isArray(target)) {
      // Pair token: expect { DEFAULT, foreground } object.
      if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const [defaultVar, foregroundVar] = target;
        if (defaultVar) emit(defaultVar, obj.DEFAULT, lines);
        if (foregroundVar) emit(foregroundVar, obj.foreground, lines);
      } else {
        // Scalar value supplied for a pair token — apply to DEFAULT only.
        const [defaultVar] = target;
        if (defaultVar) emit(defaultVar, value, lines);
      }
    } else {
      emit(target, value, lines);
    }
  }

  lines.push("}");
  return lines.join("\n");
}
