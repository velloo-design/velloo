import type { ColorPair, Theme as VellooTheme } from "@velloo/schema";
import { converter, formatHex, formatRgb, parse } from "culori";

/**
 * Chakra's color utilities (@ctrl/tinycolor inside @chakra-ui/theme-tools,
 * behind the Alert/Tag/Badge subtle variants) parse `#hex`, `rgb()/rgba()`,
 * `hsl()/hsla()` — NOT `oklch()`, which is exactly what velloo themes store.
 * Convert anything outside that set to `rgb(...)` via culori; pass
 * chakra-native formats through untouched so a hex theme stays hex (and
 * round-trips identically in codegen).
 */
function chakraColor(css: string): string {
  const s = css.trim();
  if (/^(#|rgb|hsl)/i.test(s)) return s;
  return formatRgb(parse(s)) ?? s;
}

/** A color slot is a CSS string or a { DEFAULT, foreground } pair — pull the base color (chakra-safe). */
function base(slot: ColorPair | undefined, fallback: string): string {
  if (typeof slot === "string") return chakraColor(slot);
  if (slot && typeof slot === "object" && typeof slot.DEFAULT === "string")
    return chakraColor(slot.DEFAULT);
  return chakraColor(fallback);
}

const toOklch = converter("oklch");

/**
 * Derive a chakra 50–900 `brand` color scale from the theme's primary color.
 * The primary lands verbatim at `brand.500` (what `colorScheme="brand"` solid
 * buttons use in light mode); lighter steps walk a fixed OKLCH lightness ramp
 * with chroma eased toward white, darker steps scale the base lightness down.
 * Tuned for mid-lightness brand colors (the norm); a gray primary (chroma 0)
 * degrades to a clean neutral ramp.
 */
export function brandScale(primary: string): Record<string, string> {
  const safe = chakraColor(primary);
  const okl = (() => {
    const parsed = parse(primary);
    return parsed ? toOklch(parsed) : undefined;
  })();
  if (!okl) {
    // Unparsable color: a flat scale keeps every `brand.*` reference resolving.
    return Object.fromEntries(
      ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map((k) => [k, safe]),
    );
  }
  const { l = 0.55, c = 0, h } = okl;
  const at = (lightness: number, chroma: number): string =>
    formatHex({
      mode: "oklch",
      l: Math.min(Math.max(lightness, 0), 1),
      c: Math.max(chroma, 0),
      h,
    });
  return {
    50: at(0.982, c * 0.12),
    100: at(0.955, c * 0.25),
    200: at(0.9, c * 0.45),
    300: at(0.83, c * 0.65),
    400: at(0.73, c * 0.85),
    500: safe,
    600: at(l * 0.88, c),
    700: at(l * 0.74, c * 0.95),
    800: at(l * 0.6, c * 0.85),
    900: at(l * 0.47, c * 0.72),
  };
}

/** Chakra radii are CSS lengths; coerce velloo's radius.md (number or CSS len). */
function radiusCss(theme: VellooTheme): string {
  const md = (theme.radius as Record<string, unknown> | undefined)?.md;
  if (typeof md === "number") return `${md}px`;
  if (typeof md === "string") return md;
  return "8px";
}

/** The extendTheme input POJO `chakraThemeOptions` projects — typed so tests read fields directly. */
export interface ChakraThemeOptions {
  config: { initialColorMode: "light" | "dark"; useSystemColorMode: boolean };
  colors: { brand: Record<string, string> };
  semanticTokens: { colors: Record<string, string> };
  fonts: { heading: string; body: string };
  radii: { md: string };
}

/**
 * Project velloo's unified token tree onto chakra `extendTheme` options — the
 * SINGLE source of the velloo→chakra mapping shared by the runtime render pass
 * and codegen, so the preview and the emitted theme never diverge.
 *
 * Dark is a dark-FLAVORED theme, not a mode flag: `colorsDark` overlays the
 * color slots and the projected values land as plain strings on chakra's own
 * semantic tokens (`chakra-body-bg` etc.), so they apply at `:root` — a static
 * SSR shows real dark surfaces without the client-side `data-theme` attribute
 * ColorModeScript would set. `initialColorMode` flips too so context-driven
 * (`useColorModeValue`) styling agrees.
 */
export function chakraThemeOptions(theme: VellooTheme, dark = false): ChakraThemeOptions {
  const c = dark && theme.colorsDark ? { ...theme.colors, ...theme.colorsDark } : theme.colors;
  const fg = chakraColor(c.foreground);
  const sans = theme.typography.fontFamily?.sans ?? "system-ui, -apple-system, sans-serif";
  return {
    config: { initialColorMode: dark ? "dark" : "light", useSystemColorMode: false },
    colors: { brand: brandScale(base(c.primary, "#4f46e5")) },
    semanticTokens: {
      colors: {
        "chakra-body-bg": chakraColor(c.background),
        "chakra-body-text": fg,
        ...(c.border ? { "chakra-border-color": chakraColor(c.border) } : {}),
        ...(c.muted
          ? {
              "chakra-subtle-text": base(c.muted, fg),
              "chakra-placeholder-color": base(c.muted, fg),
            }
          : {}),
      },
    },
    fonts: { heading: sans, body: sans },
    radii: { md: radiusCss(theme) },
  };
}
