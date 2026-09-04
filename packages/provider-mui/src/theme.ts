import { createTheme, type Theme as MuiTheme, type ThemeOptions } from "@mui/material/styles";
import {
  type ColorPair,
  DEFAULT_TYPESET_NAME,
  resolveColors,
  typesetScale,
  type Theme as VellooTheme,
} from "@velloo/schema";
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
  const c = resolveColors(theme, dark);
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
    typography: muiTypography(theme),
  };
}

/**
 * Project the default typeset onto MUI's typography variants.
 *
 * MUI's theme is a serialized POJO — it ends up inside a `createTheme(...)`
 * artifact where no CSS variables exist — so this reads `typesetScale`, the
 * concrete-value form of the same ratio table `typesetCss` uses symbolically.
 * The canvas render pass and the emitted artifact both come through here, so a
 * preview cannot disagree with generated code.
 */
function muiTypography(theme: VellooTheme): NonNullable<ThemeOptions["typography"]> {
  const typography = theme.typography;
  const typeset = typography.typesets?.[DEFAULT_TYPESET_NAME];
  const scale = typesetScale(typeset, {
    ...(typography.fontFamily ? { fontFamily: typography.fontFamily } : {}),
  });
  // The body face, falling back to the `sans` role then the system stack.
  const bodyFamily =
    scale.body.fontFamily ?? typography.fontFamily?.sans ?? "system-ui, -apple-system, sans-serif";

  const variant = (role: keyof typeof scale) => {
    const r = scale[role];
    return {
      // Only override the family when the typeset names a *different* face for
      // this role; otherwise inherit the theme's own fontFamily.
      ...(r.fontFamily && r.fontFamily !== bodyFamily ? { fontFamily: r.fontFamily } : {}),
      fontSize: `${r.fontSize}px`,
      lineHeight: r.lineHeight,
      letterSpacing: r.letterSpacing,
      fontWeight: r.fontWeight,
    };
  };

  return {
    fontFamily: bodyFamily,
    fontSize: scale.body.fontSize,
    h1: variant("h1"),
    h2: variant("h2"),
    h3: variant("h3"),
    h4: variant("h4"),
    h5: variant("h5"),
    h6: variant("h6"),
    subtitle1: variant("lead"),
    subtitle2: variant("small"),
    body1: variant("body"),
    body2: variant("caption"),
    caption: variant("caption"),
  };
}

/** The MUI `Theme` for the render pass — `createTheme` over {@link muiThemeOptions}. */
export function muiThemeFrom(theme: VellooTheme, dark = false): MuiTheme {
  return createTheme(muiThemeOptions(theme, dark));
}
