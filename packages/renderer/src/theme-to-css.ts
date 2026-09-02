import {
  type Colors,
  isCssIdent,
  sanitizeCssTokenValue,
  type Theme,
  typesetCss,
} from "@velloo/schema";

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
  if (typeof value === "number") {
    lines.push(`  ${varName}: ${value};`);
  } else if (typeof value === "string") {
    // Untrusted theme value — strip anything that could break out of the
    // declaration or the enclosing inline <style> element.
    lines.push(`  ${varName}: ${sanitizeCssTokenValue(value)};`);
  }
}

/**
 * Var names the semantic slots own — a palette key that collides is skipped,
 * mirroring codegen's emit (`SEMANTIC_SLOTS` in emit-theme/globals-css.ts;
 * renderer can't import codegen, so this derives the same set from
 * COLOR_TOKEN_MAP). Without the skip, `palette.muted` emits a second
 * `--color-muted` that wins in light mode while `.dark` repaints it — the
 * canvas would then diverge from the exported globals.css.
 */
const SEMANTIC_COLOR_VARS: ReadonlySet<string> = new Set(
  Object.values(COLOR_TOKEN_MAP).flatMap((target) => (Array.isArray(target) ? target : [target])),
);

/** Raw scale/role passthrough: `primary-600` → `--color-primary-600`. */
function emitPalette(palette: Record<string, string> | undefined, lines: string[]): void {
  if (!palette) return;
  for (const [name, value] of Object.entries(palette)) {
    if (!isCssIdent(name)) continue;
    if (SEMANTIC_COLOR_VARS.has(`--color-${name}`)) continue;
    emit(`--color-${name}`, value, lines);
  }
}

/** Named spacing tokens: `icon-rail` → `--spacing-icon-rail` (Tailwind v4 → `w-icon-rail`). */
function emitSpacing(spacing: Theme["spacing"], lines: string[]): void {
  if (!spacing) return;
  for (const [name, value] of Object.entries(spacing)) {
    // Skip the numeric Tailwind scale (0/1/2/…) — built in; only named tokens need a var.
    if (!Number.isNaN(Number(name))) continue;
    if (!isCssIdent(name)) continue;
    if (typeof value === "string" || typeof value === "number") {
      emit(`--spacing-${name}`, value, lines);
    }
  }
}

/** Named box-shadows: `card` → `--shadow-card` (Tailwind v4 → `shadow-card`). */
function emitShadows(shadows: Theme["shadows"], lines: string[]): void {
  if (!shadows) return;
  for (const [name, value] of Object.entries(shadows)) {
    if (!isCssIdent(name)) continue;
    if (typeof value === "string" || typeof value === "number") {
      emit(`--shadow-${name}`, value, lines);
    }
  }
}

/**
 * Override `.container` to match the host app's config. Injected after the
 * snapshot CSS (see document.ts), so this wins over Tailwind's stock
 * `.container` — `class="container"` then centers / pads / caps as the app does.
 */
function emitContainer(container: Theme["container"], lines: string[]): void {
  if (!container) return;
  const decls = ["  width: 100%;"];
  if (container.center) decls.push("  margin-inline: auto;");
  if (container.padding) {
    decls.push(`  padding-inline: ${sanitizeCssTokenValue(container.padding)};`);
  }
  if (container.maxWidth) decls.push(`  max-width: ${sanitizeCssTokenValue(container.maxWidth)};`);
  lines.push("", ".container {", ...decls, "}");
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
  emitPalette(theme.palette, lines);
  emitSpacing(theme.spacing, lines);
  emitShadows(theme.shadows, lines);

  const fontFamily = theme.typography.fontFamily;
  if (fontFamily) {
    // Every role becomes a --font-<role> token; Tailwind v4 then owns
    // the matching `font-<role>` utility (compiled by the JIT, which
    // mirrors these tokens into its @theme — see tailwind-jit.ts).
    for (const [role, stack] of Object.entries(fontFamily)) {
      if (!isCssIdent(role)) continue;
      emit(`--font-${role}`, stack, lines);
    }
  }

  // Radius: a single --radius pulled from radius.md (or radius.lg / .sm as fallback).
  const radiusValue = theme.radius.md ?? theme.radius.lg ?? theme.radius.sm;
  if (radiusValue !== undefined) {
    const formatted =
      typeof radiusValue === "number" ? `${radiusValue}px` : sanitizeCssTokenValue(radiusValue);
    lines.push(`  --radius: ${formatted};`);
  }

  lines.push("}");

  // Dark-mode overrides — gated on a `.dark` ancestor so the canvas can flip
  // a single class to preview both modes without re-rendering.
  if (theme.colorsDark || theme.paletteDark) {
    lines.push("");
    lines.push(".dark {");
    emitColorBlock(theme.colorsDark ?? {}, lines);
    emitPalette(theme.paletteDark, lines);
    lines.push("}");
  }

  emitContainer(theme.container, lines);

  // Typesets last: the generated sheet re-declares the derived `--text-*` /
  // `--leading-*` / `--tracking-*` tokens the compiled Tailwind @theme block
  // seeded with placeholders, so it must come after them to win.
  return [lines.join("\n"), typesetCss(theme.typography.typesets)].join("\n\n");
}
