import { ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { derivePalette } from "./derive-palette.ts";
import type { ThemeError } from "./errors.ts";
import { pruneGoogleFonts } from "./set-fonts.ts";

/**
 * Places to start a design language from. Each is a direction, not a
 * framework: a colour, a pair of faces and a corner radius that together read
 * as one thing, and that differ from each other on all three — eight blues
 * with Inter would be one choice offered eight times.
 *
 * The rest of the palette — neutrals, accent, the dark mode — is derived from
 * the primary the way a seed colour's is, with contrast checked, so every
 * entry lands as a complete light and dark theme.
 */
export interface StartingPoint {
  id: string;
  name: string;
  /** What it sets, for the picker: colour · faces · corners. */
  note: string;
  primary: string;
  /** Stated only where a brightened primary would lose the direction's character. */
  primaryDark?: string;
  /**
   * `typography.fontFamily` stacks. `sans` is the body face; `display`, where
   * there is one, becomes the heading face, and headings follow the body
   * otherwise.
   */
  fonts: { sans: string; display?: string; mono?: string };
  /** Google Fonts css2 specs for the families above. */
  googleFonts: string[];
  /** Corner radius in px — the theme's base radius. */
  radius: number;
}

const SANS_TAIL = "ui-sans-serif, system-ui, sans-serif";
const SERIF_TAIL = "ui-serif, Georgia, serif";
const MONO_TAIL = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const STARTING_POINTS: readonly StartingPoint[] = [
  {
    id: "ink",
    name: "Ink",
    note: "Near-black · Geist · 10px",
    primary: "#171717",
    primaryDark: "#e5e5e5",
    fonts: { sans: `"Geist", ${SANS_TAIL}`, mono: `"Geist Mono", ${MONO_TAIL}` },
    googleFonts: ["Geist:wght@400..700", "Geist+Mono:wght@400..600"],
    radius: 10,
  },
  {
    id: "cobalt",
    name: "Cobalt",
    note: "Blue · Inter · 6px",
    primary: "#2563eb",
    fonts: { sans: `"Inter", ${SANS_TAIL}` },
    googleFonts: ["Inter:wght@400..700"],
    radius: 6,
  },
  {
    id: "ember",
    name: "Ember",
    note: "Burnt orange · DM Serif + DM Sans · 12px",
    primary: "#c2410c",
    fonts: { sans: `"DM Sans", ${SANS_TAIL}`, display: `"DM Serif Display", ${SERIF_TAIL}` },
    googleFonts: ["DM+Sans:wght@400..700", "DM+Serif+Display"],
    radius: 12,
  },
  {
    id: "moss",
    name: "Moss",
    note: "Olive · Source Serif + Source Sans · 4px",
    primary: "#3f6212",
    fonts: {
      sans: `"Source Sans 3", ${SANS_TAIL}`,
      display: `"Source Serif 4", ${SERIF_TAIL}`,
    },
    googleFonts: ["Source+Sans+3:wght@400..700", "Source+Serif+4:wght@400..700"],
    radius: 4,
  },
  {
    id: "orchid",
    name: "Orchid",
    note: "Magenta · Outfit · pill",
    primary: "#a21caf",
    fonts: { sans: `"Outfit", ${SANS_TAIL}` },
    googleFonts: ["Outfit:wght@400..700"],
    radius: 20,
  },
  {
    id: "citrus",
    name: "Citrus",
    note: "Yellow · Space Grotesk · square",
    primary: "#facc15",
    fonts: {
      sans: `"Space Grotesk", ${SANS_TAIL}`,
      mono: `"JetBrains Mono", ${MONO_TAIL}`,
    },
    googleFonts: ["Space+Grotesk:wght@400..700", "JetBrains+Mono:wght@400..600"],
    radius: 0,
  },
  {
    id: "lagoon",
    name: "Lagoon",
    note: "Teal · Manrope · 8px",
    primary: "#0f766e",
    fonts: { sans: `"Manrope", ${SANS_TAIL}` },
    googleFonts: ["Manrope:wght@400..700"],
    radius: 8,
  },
  {
    id: "blush",
    name: "Blush",
    note: "Rose · Fraunces + Figtree · 16px",
    primary: "#e11d48",
    fonts: { sans: `"Figtree", ${SANS_TAIL}`, display: `"Fraunces", ${SERIF_TAIL}` },
    googleFonts: ["Figtree:wght@400..700", "Fraunces:wght@400..700"],
    radius: 16,
  },
];

/**
 * The theme a starting point makes of the current one. Colour, faces and
 * radius are replaced; rhythm, spacing and everything else the theme already
 * says is kept, since a starting point has no opinion about them.
 */
export function startingPointTheme(
  point: StartingPoint,
  current: Theme,
): Result<Theme, ThemeError> {
  const derived = derivePalette(point.primary, current, undefined, {
    exactPrimary: true,
    primaryDark: point.primaryDark,
  });
  if (!derived.ok) return derived;
  const fontFamily = { ...current.typography.fontFamily, ...point.fonts };
  // Without a display face headings follow the body: clearing `fontHeading` is
  // what lets them, and a heading face left over from the old theme would make
  // every direction look like the one before it.
  const {
    fontHeading: _replaced,
    fontMono: _mono,
    ...rhythm
  } = current.typography.typesets?.default ?? {};
  return ok({
    ...derived.value.theme,
    typography: {
      ...current.typography,
      fontFamily,
      googleFonts: pruneGoogleFonts(
        [...point.googleFonts, ...(current.typography.googleFonts ?? [])],
        fontFamily,
      ),
      typesets: {
        ...current.typography.typesets,
        default: {
          ...rhythm,
          fontBody: "sans",
          ...(point.fonts.display ? { fontHeading: "display" } : {}),
          ...(fontFamily.mono ? { fontMono: "mono" } : {}),
        },
      },
    },
    radius: { md: `${point.radius / 16}rem` },
  });
}

/** The parts of a theme a starting point decides — what "still exactly this one" is judged on. */
function decided(theme: Theme, point: StartingPoint): string {
  const faces = theme.typography.typesets?.default;
  return JSON.stringify([
    theme.colors,
    theme.colorsDark,
    theme.radius,
    Object.keys(point.fonts).map((role) => theme.typography.fontFamily?.[role]),
    [faces?.fontBody, faces?.fontHeading],
  ]);
}

/**
 * The starting point this theme still is, or null once anything it set has
 * been changed by hand — a role recoloured, a face swapped, the corners moved.
 */
export function matchingStartingPoint(theme: Theme): string | null {
  for (const point of STARTING_POINTS) {
    const built = startingPointTheme(point, theme);
    if (built.ok && decided(built.value, point) === decided(theme, point)) return point.id;
  }
  return null;
}
