import { identifierRef } from "@velloo/provider";
import {
  type ColorPair,
  DEFAULT_TYPESET_NAME,
  resolveColors,
  typesetScale,
  type Theme as VellooTheme,
} from "@velloo/schema";
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
  const c = resolveColors(theme, dark);
  return {
    colorPrimary: base(c.primary, "#4f46e5"),
    colorBgBase: antdColor(c.background),
    colorTextBase: antdColor(c.foreground),
    colorError: base(c.destructive, "#dc2626"),
    borderRadius: radiusPx(theme),
    ...antdTypography(theme),
    ...(c.card ? { colorBgContainer: base(c.card, c.background) } : {}),
  };
}

/**
 * Project the default typeset onto antd's typography seed tokens.
 *
 * antd derives its whole type scale from `fontSize` plus the five
 * `fontSizeHeading*` tokens, which is close enough to velloo's ladder to map
 * directly. Values come from `typesetScale` — the concrete-value form of the
 * same ratio table `typesetCss` uses symbolically — because a seed token ends
 * up in a serialized `ThemeConfig` where no CSS variables exist.
 *
 * antd has only five heading tokens (h1–h5), so the velloo `h6` rung has no
 * antd equivalent and is intentionally dropped here; `Prose` regions still get
 * it from the typeset CSS.
 */
function antdTypography(theme: VellooTheme): NonNullable<ThemeConfig["token"]> {
  const typography = theme.typography;
  const scale = typesetScale(typography.typesets?.[DEFAULT_TYPESET_NAME], {
    ...(typography.fontFamily ? { fontFamily: typography.fontFamily } : {}),
  });
  return {
    fontFamily:
      scale.body.fontFamily ??
      typography.fontFamily?.sans ??
      "system-ui, -apple-system, sans-serif",
    fontSize: scale.body.fontSize,
    fontSizeSM: scale.caption.fontSize,
    fontSizeLG: scale.lead.fontSize,
    fontSizeHeading1: scale.h1.fontSize,
    fontSizeHeading2: scale.h2.fontSize,
    fontSizeHeading3: scale.h3.fontSize,
    fontSizeHeading4: scale.h4.fontSize,
    fontSizeHeading5: scale.h5.fontSize,
    lineHeight: scale.body.lineHeight,
    lineHeightHeading1: scale.h1.lineHeight,
    lineHeightHeading2: scale.h2.lineHeight,
    lineHeightHeading3: scale.h3.lineHeight,
    lineHeightHeading4: scale.h4.lineHeight,
    lineHeightHeading5: scale.h5.lineHeight,
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
