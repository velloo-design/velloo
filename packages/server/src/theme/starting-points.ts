import { ok, type Result } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { derivePalette } from "./derive-palette.ts";
import type { ThemeError } from "./errors.ts";
import { pruneGoogleFonts } from "./set-fonts.ts";

/**
 * Places to start a design language from, each named after a published design
 * system and carrying the three things that most make it recognisable: its
 * primary colour, its typeface and its corner radius.
 *
 * Only those three are the system's own. The rest of the palette — neutrals,
 * accent, the dark mode — is derived from the primary the way a seed colour's
 * is, with contrast checked. That keeps every entry a complete light and dark
 * theme without this file claiming to reproduce anyone's full token set.
 */
export interface StartingPoint {
  id: string;
  /** The design system it starts from. */
  name: string;
  /** What it borrows, for the picker: colour · face · corners. */
  note: string;
  primary: string;
  /** The system's own dark-mode primary, where it publishes one. */
  primaryDark?: string;
  /** `typography.fontFamily` stacks. `sans` is the body face; headings follow it. */
  fonts: { sans: string; mono?: string };
  /** Google Fonts css2 specs for the families above that need loading. */
  googleFonts: string[];
  /** Corner radius in px — the theme's `radius.md`. */
  radius: number;
}

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const STARTING_POINTS: readonly StartingPoint[] = [
  {
    id: "shadcn",
    name: "shadcn/ui",
    note: "Neutral · Geist · 10px",
    primary: "#171717",
    primaryDark: "#e5e5e5",
    fonts: {
      sans: '"Geist", ui-sans-serif, system-ui, sans-serif',
      mono: `"Geist Mono", ${SYSTEM_MONO}`,
    },
    googleFonts: ["Geist:wght@400..700", "Geist+Mono:wght@400..600"],
    radius: 10,
  },
  {
    id: "material-3",
    name: "Material 3",
    note: "Purple · Roboto · 12px",
    primary: "#6750a4",
    primaryDark: "#d0bcff",
    fonts: {
      sans: '"Roboto", ui-sans-serif, system-ui, sans-serif',
      mono: `"Roboto Mono", ${SYSTEM_MONO}`,
    },
    googleFonts: ["Roboto:wght@400;500;700", "Roboto+Mono:wght@400;500"],
    radius: 12,
  },
  {
    id: "carbon",
    name: "IBM Carbon",
    note: "Blue 60 · IBM Plex · square",
    primary: "#0f62fe",
    fonts: {
      sans: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
      mono: `"IBM Plex Mono", ${SYSTEM_MONO}`,
    },
    googleFonts: ["IBM+Plex+Sans:wght@400;500;600", "IBM+Plex+Mono:wght@400;500"],
    radius: 0,
  },
  {
    id: "fluent-2",
    name: "Fluent 2",
    note: "Blue · Segoe UI · 4px",
    primary: "#0f6cbd",
    fonts: {
      sans: '"Segoe UI", "Segoe UI Variable", system-ui, -apple-system, sans-serif',
      mono: SYSTEM_MONO,
    },
    googleFonts: [],
    radius: 4,
  },
  {
    id: "ant-design",
    name: "Ant Design",
    note: "Blue · system · 6px",
    primary: "#1677ff",
    fonts: { sans: SYSTEM_SANS, mono: SYSTEM_MONO },
    googleFonts: [],
    radius: 6,
  },
  {
    id: "untitled-ui",
    name: "Untitled UI",
    note: "Violet · Inter · 8px",
    primary: "#7f56d9",
    fonts: { sans: '"Inter", ui-sans-serif, system-ui, sans-serif', mono: SYSTEM_MONO },
    googleFonts: ["Inter:wght@400..700"],
    radius: 8,
  },
  {
    id: "polaris",
    name: "Shopify Polaris",
    note: "Ink · Inter · 8px",
    primary: "#303030",
    primaryDark: "#e3e3e3",
    fonts: { sans: '"Inter", ui-sans-serif, system-ui, sans-serif', mono: SYSTEM_MONO },
    googleFonts: ["Inter:wght@400..700"],
    radius: 8,
  },
  {
    id: "bootstrap",
    name: "Bootstrap",
    note: "Blue · system · 6px",
    primary: "#0d6efd",
    fonts: { sans: SYSTEM_SANS, mono: SYSTEM_MONO },
    googleFonts: [],
    radius: 6,
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
  // Headings follow the body face: clearing `fontHeading` is what lets them,
  // and leaving a display face from the old theme on would misrepresent a
  // system whose whole voice is one family.
  const { fontHeading: _replaced, ...rhythm } = current.typography.typesets?.default ?? {};
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
        default: { ...rhythm, fontBody: "sans", ...(point.fonts.mono ? { fontMono: "mono" } : {}) },
      },
    },
    radius: { md: `${point.radius / 16}rem` },
  });
}
