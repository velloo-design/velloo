import { createTheme, type Theme as MuiTheme, type ThemeOptions } from "@mui/material/styles";
import type { ColorPair, Theme as VellooTheme } from "@velloo/schema";
import { formatRgb, parse } from "culori";

/**
 * MUI's color manipulator (lighten/darken in createPalette) only parses
 * `#hex`, `rgb()/rgba()`, `hsl()/hsla()`, `color()` — NOT `oklch()`, which is
 * exactly what velloo themes store. Convert anything outside MUI's set to
 * `rgb(...)` via culori; pass MUI-native formats through untouched so a hex
 * theme stays hex (and round-trips identically in codegen).
 */
function muiColor(css: string): string {
  const s = css.trim();
  if (/^(#|rgb|hsl)/i.test(s)) return s;
  return formatRgb(parse(s)) ?? s;
}

/** A color slot is a CSS string or a { DEFAULT, foreground } pair — pull the base color (MUI-safe). */
function base(slot: ColorPair | undefined, fallback: string): string {
  if (typeof slot === "string") return muiColor(slot);
  if (slot && typeof slot === "object" && typeof slot.DEFAULT === "string")
    return muiColor(slot.DEFAULT);
  return muiColor(fallback);
}

/** The `foreground` half of a pair (the on-color, MUI-safe), or a fallback. */
function fg(slot: ColorPair | undefined, fallback: string): string {
  if (slot && typeof slot === "object" && typeof slot.foreground === "string")
    return muiColor(slot.foreground);
  return muiColor(fallback);
}

/** MUI's shape.borderRadius is a px number; coerce velloo's radius.md (number or CSS len). */
function radiusPx(theme: VellooTheme): number {
  const md = (theme.radius as Record<string, unknown> | undefined)?.md;
  if (typeof md === "number") return md;
  if (typeof md === "string") {
    const n = Number.parseFloat(md);
    return Number.isFinite(n) ? (md.includes("rem") ? n * 16 : n) : 8;
  }
  return 8;
}

/**
 * Project velloo's unified token tree onto MUI `ThemeOptions` (the input POJO
 * for `createTheme`) — the adapter's `themeToNative`. This is the SINGLE source
 * of the velloo→MUI mapping: `muiThemeFrom` wraps it for the canvas render
 * pass, and codegen serializes the same POJO to a `createTheme(...)` artifact,
 * so the preview and the emitted theme never diverge. velloo colors are
 * arbitrary CSS strings (oklch/hsl/hex); MUI's palette accepts any CSS color.
 */
export function muiThemeOptions(theme: VellooTheme, dark = false): ThemeOptions {
  // In dark mode, overlay the theme's dark color slots — otherwise flipping
  // palette.mode to "dark" would keep the light color values.
  const c = dark && theme.colorsDark ? { ...theme.colors, ...theme.colorsDark } : theme.colors;
  return {
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: base(c.primary, "#4f46e5"), contrastText: fg(c.primary, "#ffffff") },
      secondary: { main: base(c.secondary, "#64748b"), contrastText: fg(c.secondary, "#ffffff") },
      error: { main: base(c.destructive, "#dc2626"), contrastText: fg(c.destructive, "#ffffff") },
      background: { default: muiColor(c.background), paper: base(c.card, c.background) },
      text: { primary: muiColor(c.foreground), secondary: base(c.muted, c.foreground) },
      divider: c.border ? muiColor(c.border) : "rgba(0,0,0,0.12)",
    },
    shape: { borderRadius: radiusPx(theme) },
    typography: {
      fontFamily: theme.typography.fontFamily?.sans ?? "system-ui, -apple-system, sans-serif",
    },
  };
}

/** The MUI `Theme` for the render pass — `createTheme` over {@link muiThemeOptions}. */
export function muiThemeFrom(theme: VellooTheme, dark = false): MuiTheme {
  return createTheme(muiThemeOptions(theme, dark));
}
