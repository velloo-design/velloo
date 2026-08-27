import { identifierRef } from "@velloo/provider";
import type { ColorPair, Theme as VellooTheme } from "@velloo/schema";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";
import { formatRgb, parse } from "culori";

/**
 * antd's token engine derives its palette ramps with @ant-design/fast-color,
 * which parses `#hex`, `rgb()/rgba()`, `hsl()/hsla()` — NOT `oklch()`, which is
 * exactly what velloo themes store. Convert anything outside that set to
 * `rgb(...)` via culori; pass antd-native formats through untouched so a hex
 * theme stays hex (and round-trips identically in codegen).
 */
function antdColor(css: string): string {
  const s = css.trim();
  if (/^(#|rgb|hsl)/i.test(s)) return s;
  return formatRgb(parse(s)) ?? s;
}

/** A color slot is a CSS string or a { DEFAULT, foreground } pair — pull the base color (antd-safe). */
function base(slot: ColorPair | undefined, fallback: string): string {
  if (typeof slot === "string") return antdColor(slot);
  if (slot && typeof slot === "object" && typeof slot.DEFAULT === "string")
    return antdColor(slot.DEFAULT);
  return antdColor(fallback);
}

/** antd's `borderRadius` token is a px number; coerce velloo's radius.md (number or CSS len). */
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
 * Project velloo's unified token tree onto antd's seed tokens — the SINGLE
 * source of the velloo→antd mapping shared by the runtime render pass and
 * codegen, so the preview and the emitted theme never diverge. In dark mode,
 * overlay the theme's dark color slots — otherwise the dark algorithm would
 * derive from the light color values.
 */
function antdTokens(theme: VellooTheme, dark: boolean): NonNullable<ThemeConfig["token"]> {
  const c = dark && theme.colorsDark ? { ...theme.colors, ...theme.colorsDark } : theme.colors;
  return {
    colorPrimary: base(c.primary, "#4f46e5"),
    colorBgBase: antdColor(c.background),
    colorTextBase: antdColor(c.foreground),
    colorError: base(c.destructive, "#dc2626"),
    borderRadius: radiusPx(theme),
    fontFamily: theme.typography.fontFamily?.sans ?? "system-ui, -apple-system, sans-serif",
    ...(c.card ? { colorBgContainer: base(c.card, c.background) } : {}),
  };
}

/**
 * The runtime `ThemeConfig` for the render pass — carries the REAL algorithm
 * function (antd derives its map tokens by calling it). `cssVar: true` also
 * publishes every token as an `--ant-*` CSS variable, so inline `style`
 * objects (this provider's style channel) can reference theme values.
 */
export function antdThemeConfig(theme: VellooTheme, dark = false): ThemeConfig {
  return {
    cssVar: true,
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: antdTokens(theme, dark),
  };
}

/**
 * The codegen projection (`themeToNative`): the same token mapping, but the
 * algorithm emits as a bare identifier (`antdTheme.darkAlgorithm`) that the
 * theme module's import line brings into scope — a function can't serialize.
 * The light flavor references `defaultAlgorithm` explicitly (identical to
 * antd's default) so the aliased import is always used in the emitted module.
 */
export function antdThemeOptions(theme: VellooTheme, dark = false): unknown {
  return {
    cssVar: true,
    algorithm: identifierRef(dark ? "antdTheme.darkAlgorithm" : "antdTheme.defaultAlgorithm"),
    token: antdTokens(theme, dark),
  };
}
