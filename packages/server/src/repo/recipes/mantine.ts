import { type ColorPair, resolveColors, type Theme } from "@velloo/schema";
import { clampChroma, converter, formatHex, parse, toGamut } from "culori";
import type { FrameworkRecipe } from "./types.ts";

/**
 * Mantine (v7+). Its styles ship as plain CSS (`@mantine/core/styles.css`) and
 * every component needs a `MantineProvider` above it, so the default preview
 * entry is exactly those two things. Overlays accept `withinPortal={false}`,
 * which keeps an opened Menu or Modal inside the frame instead of escaping to
 * `document.body`.
 */

const OVERLAY_NOTE = "Rendered inside the frame (withinPortal=false) so it stays selectable.";
const inline = { withinPortal: false, transitionProps: { duration: 0 } };

export const mantineRecipe: FrameworkRecipe = {
  id: "mantine",
  label: "Mantine",
  packages: ["@mantine/core", "@mantine/dates", "@mantine/charts", "@mantine/notifications"],
  previewModule(resolve) {
    const react = resolve("react");
    const core = resolve("@mantine/core");
    const styles = resolve("@mantine/core/styles.css");
    if (!react || !core || !styles) return null;
    const extras = ["@mantine/dates/styles.css", "@mantine/charts/styles.css"]
      .map(resolve)
      .filter((path): path is string => path !== null);
    return [
      `import ${JSON.stringify(styles)};`,
      ...extras.map((path) => `import ${JSON.stringify(path)};`),
      `import * as React from ${JSON.stringify(react)};`,
      `import { MantineProvider, createTheme } from ${JSON.stringify(core)};`,
      "export default function VellooMantinePreview(props) {",
      "  return React.createElement(MantineProvider, {",
      "    theme: createTheme(props.recipeTheme || {}),",
      '    forceColorScheme: props.colorScheme === "dark" ? "dark" : "light",',
      "  }, props.children);",
      "}",
      "",
    ].join("\n");
  },
  themeToNative: mantineThemeOptions,
  themeModule: {
    importLines: ['import { createTheme } from "@mantine/core";'],
    factory: "createTheme",
    defaultPath: "theme.ts",
  },
  adaptations: {
    Menu: { props: inline, note: OVERLAY_NOTE },
    Popover: { props: inline, note: OVERLAY_NOTE },
    HoverCard: { props: inline, note: OVERLAY_NOTE },
    Tooltip: { props: inline, note: OVERLAY_NOTE },
    Select: { props: { comboboxProps: inline }, note: OVERLAY_NOTE },
    MultiSelect: { props: { comboboxProps: inline }, note: OVERLAY_NOTE },
    Autocomplete: { props: { comboboxProps: inline }, note: OVERLAY_NOTE },
    Combobox: { props: inline, note: OVERLAY_NOTE },
    Modal: {
      props: { ...inline, trapFocus: false, lockScroll: false, returnFocus: false },
      note: "Rendered open inside the frame, without focus trapping or scroll locking.",
    },
    Drawer: {
      props: { ...inline, trapFocus: false, lockScroll: false, returnFocus: false },
      note: "Rendered open inside the frame, without focus trapping or scroll locking.",
    },
  },
  styleProps: ["style", "className"],
  stylesheetProbe: {
    html: '<div data-mantine-color-scheme="light"><span class="mantine-light-hidden"></span></div>',
    selector: ".mantine-light-hidden",
    property: "display",
    expect: "none",
    stylesheet: "@mantine/core/styles.css",
  },
  groups: {
    AppShell: "layout",
    Group: "layout",
    SimpleGrid: "layout",
    Grid: "layout",
    Center: "layout",
    Paper: "layout",
    ScrollArea: "layout",
    RingProgress: "feedback",
    Timeline: "display",
    ThemeIcon: "visuals",
    SegmentedControl: "forms",
    Burger: "navigation",
  },
  notes: [
    "Mantine components render for real from the app's install, inside a MantineProvider. Set Mantine props directly (`variant`, `size`, `color`, `radius`) and use its style props (`p`, `m`, `c`, `bg`, `w`) or `style` for one-off styling — emitted code keeps them as written.",
    "Compose layout with Mantine's own `Group`, `Stack`, `Grid` and `SimpleGrid` rather than Velloo `Box` where the app does, so emitted code stays idiomatic Mantine.",
    "Overlays (Menu, Popover, Modal, Select) render inside the frame; set `opened` / `defaultOpened` to show one open.",
  ],
};

/**
 * Velloo tokens → Mantine `createTheme` input. The primary color becomes a
 * ten-shade `velloo` palette with the token itself at Mantine's default filled
 * shade (6), so `color="velloo"` and every primary-colored component match
 * the design exactly; neighbours step lightness in OKLCH at the same hue.
 */
function mantineThemeOptions(theme: Theme, dark = false): Record<string, unknown> {
  const colors = resolveColors(theme, dark);
  const primary = baseColor(colors.primary) ?? "#4f46e5";
  const body = theme.typography.fontFamily?.sans;
  const heading = theme.typography.fontFamily?.display ?? theme.typography.fontFamily?.heading;
  return {
    primaryColor: "velloo",
    primaryShade: { light: 6, dark: 6 },
    colors: { velloo: shades(primary) },
    white: hex(dark ? colors.foreground : colors.background) ?? "#ffffff",
    black: hex(dark ? colors.background : colors.foreground) ?? "#000000",
    ...(radiusPx(theme) !== undefined ? { defaultRadius: radiusPx(theme) } : {}),
    ...(body ? { fontFamily: body } : {}),
    ...(heading || body ? { headings: { fontFamily: heading ?? body } } : {}),
  };
}

function baseColor(slot: ColorPair | undefined): string | undefined {
  if (typeof slot === "string") return hex(slot);
  return slot ? hex(slot.DEFAULT) : undefined;
}

function hex(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const parsed = parse(css);
  return parsed ? formatHex(toGamut("rgb", "oklch")(parsed)) : undefined;
}

const LIGHTNESS = [0.97, 0.93, 0.86, 0.78, 0.7, 0.62, 0, 0.46, 0.39, 0.32];
const toOklch = converter("oklch");

function shades(primary: string): string[] {
  const base = toOklch(parse(primary));
  if (!base) return Array(10).fill(primary);
  return LIGHTNESS.map((l, i) =>
    i === 6
      ? primary
      : formatHex(
          toGamut(
            "rgb",
            "oklch",
          )(clampChroma({ mode: "oklch", l, c: base.c ?? 0, h: base.h ?? 0 }, "oklch")),
        ),
  );
}

function radiusPx(theme: Theme): number | undefined {
  const md = theme.radius.md;
  if (typeof md === "number") return md;
  if (typeof md !== "string") return undefined;
  const n = Number.parseFloat(md);
  if (!Number.isFinite(n)) return undefined;
  return md.endsWith("rem") ? n * 16 : n;
}
