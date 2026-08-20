import { createTheme, type Theme as MuiTheme } from "@mui/material/styles";
import type { ColorPair, Theme as VellooTheme } from "@velloo/schema";

/** A color slot is a CSS string or a { DEFAULT, foreground } pair — pull the base color. */
function base(slot: ColorPair | undefined, fallback: string): string {
  if (typeof slot === "string") return slot;
  if (slot && typeof slot === "object" && typeof slot.DEFAULT === "string") return slot.DEFAULT;
  return fallback;
}

/** The `foreground` half of a pair (the on-color), or a fallback. */
function fg(slot: ColorPair | undefined, fallback: string): string {
  if (slot && typeof slot === "object" && typeof slot.foreground === "string") return slot.foreground;
  return fallback;
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
 * Project velloo's unified token tree onto a MUI Theme (the adapter's
 * `themeToNative`). Used both to drive the canvas render pass and — later — to
 * emit a `createTheme(...)` artifact in codegen. velloo colors are arbitrary
 * CSS strings (oklch/hsl/hex); MUI's palette accepts any CSS color.
 */
export function muiThemeFrom(theme: VellooTheme, dark = false): MuiTheme {
  const c = theme.colors;
  return createTheme({
    palette: {
      mode: dark ? "dark" : "light",
      primary: { main: base(c.primary, "#4f46e5"), contrastText: fg(c.primary, "#ffffff") },
      secondary: { main: base(c.secondary, "#64748b"), contrastText: fg(c.secondary, "#ffffff") },
      error: { main: base(c.destructive, "#dc2626"), contrastText: fg(c.destructive, "#ffffff") },
      background: { default: c.background, paper: base(c.card, c.background) },
      text: { primary: c.foreground, secondary: base(c.muted, c.foreground) },
      divider: c.border ?? "rgba(0,0,0,0.12)",
    },
    shape: { borderRadius: radiusPx(theme) },
    typography: {
      fontFamily: theme.typography.fontFamily?.sans ?? "system-ui, -apple-system, sans-serif",
    },
  });
}
