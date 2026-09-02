import { describe, expect, test } from "bun:test";
import { emitCode, emitNativeTheme, moduleTarget } from "@velloo/codegen";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider } from "@velloo/provider-chakra";
import { renderScreen } from "@velloo/renderer";
import { unwrap } from "@velloo/result";
import { type Screen, type Theme, TYPESET_SCALE_NAMES, typesetScale } from "@velloo/schema";

/**
 * The chakra twin of mui-render.test.ts / antd-render.test.ts: a
 * chakra-native screen SSRs to REAL Chakra v2 markup with its emotion styles
 * captured — in-process, no client bundle. Proves the adapter's registry +
 * emotion renderPass work end-to-end through the renderer, and sweeps the
 * WHOLE registry through SSR (chakra parts throw outside their parent's
 * context, so the sweep is the canvas-safety contract for every id).
 */

const chakra = createProvider();

const theme: Theme = {
  name: "t",
  colors: {
    background: "#ffffff",
    foreground: "#111827",
    primary: { DEFAULT: "#4f46e5", foreground: "#ffffff" },
  },
  typography: { fontFamily: { sans: "Inter, sans-serif" } },
  spacing: { 1: 4 },
  radius: { md: 12 },
};

const screen: Screen = {
  id: "s",
  name: "S",
  tree: {
    $ref: "Card",
    props: { variant: "outline" },
    children: [
      {
        $ref: "CardBody",
        children: [
          { $ref: "Heading", props: { size: "lg", children: "Hello chakra" } },
          { $ref: "Button", props: { colorScheme: "brand", children: "Go" } },
        ],
      },
    ],
  },
};

describe("chakra adapter SSR", () => {
  test("renders real chakra components + extracts emotion styles", async () => {
    const { html, bodyHtml } = await renderScreen(screen, theme, {
      viewport: { w: 1280, h: 800 },
      snapshotCss: "",
      registry: chakra.registry,
      renderPass: chakra.renderPass?.(theme),
    });
    // Real chakra components rendered (their stable class names + content).
    expect(bodyHtml).toContain("chakra-card");
    expect(bodyHtml).toContain("chakra-heading");
    expect(bodyHtml).toContain("chakra-button");
    expect(bodyHtml).toContain("Hello chakra");
    expect(bodyHtml).toContain("Go");
    // The emotion render pass injected a tagged style block with real rules.
    expect(html).toContain("data-velloo-adapter");
    expect(html).toMatch(/\.vchakra-[a-z0-9]+/); // per-render emotion cache key
    // velloo theme tokens projected onto chakra: the brand scale (primary at
    // brand.500, verbatim), the semantic body colors, and the radius all
    // reached the extracted globals as --chakra-* CSS variables.
    expect(html).toContain("--chakra-colors-brand-500");
    expect(html).toContain("#4f46e5");
    expect(html).toMatch(/--chakra-colors-chakra-body-bg:\s*#ffffff/i);
    expect(html).toMatch(/--chakra-radii-md:\s*12px/);
  });

  test("adapter declares the sx channel (chakra's native style prop, no Tailwind)", () => {
    expect(chakra.styleChannel?.kind).toBe("sx");
    expect(chakra.styleChannel?.needsTailwindJit).toBe(false);
    expect(chakra.styleChannels).toEqual(["sx"]);
  });

  test("chakra folders get the velloo Icon helper (chakra's icon set isn't surfaced)", async () => {
    const iconScreen: Screen = {
      id: "i",
      name: "I",
      tree: {
        $ref: "Button",
        props: { colorScheme: "brand" },
        children: [{ $ref: "Icon", props: { name: "ArrowRight", size: 18 } }],
      },
    };
    const { bodyHtml } = await renderScreen(iconScreen, theme, {
      viewport: { w: 400, h: 200 },
      snapshotCss: "",
      registry: chakra.registry,
      renderPass: chakra.renderPass?.(theme),
    });
    expect(bodyHtml).toContain("chakra-button"); // real chakra button
    expect(bodyHtml).toContain("<svg"); // the lucide icon rendered (sized via `size`, not Tailwind)
    expect(bodyHtml).toContain('width="18"');
    // The manifest surfaces Icon so list_components shows it.
    const manifest = await chakra.loadManifest();
    expect(manifest.find((c) => c.id === "Icon")).toBeDefined();
  });

  test("catalog() reports every manifest component installed from @chakra-ui/react", async () => {
    const catalog = (await chakra.catalog?.()) ?? [];
    expect(catalog.length).toBeGreaterThan(50);
    const button = catalog.find((e) => e.id === "Button");
    expect(button?.installed).toBe(true); // the whole curated chakra set is bundled
    expect(button?.importPath).toBe("@chakra-ui/react");
  });

  test("overlay compositions render open + inline (Modal content is visible in SSR)", async () => {
    const modalScreen: Screen = {
      id: "d",
      name: "D",
      tree: {
        $ref: "Modal",
        props: { size: "md" },
        children: [
          { $ref: "ModalOverlay" },
          {
            $ref: "ModalContent",
            children: [
              { $ref: "ModalCloseButton" },
              { $ref: "ModalHeader", props: { children: "Delete item?" } },
              { $ref: "ModalBody", props: { children: "This is permanent." } },
              {
                $ref: "ModalFooter",
                children: [{ $ref: "Button", props: { colorScheme: "red", children: "Delete" } }],
              },
            ],
          },
        ],
      },
    };
    const { bodyHtml } = await renderScreen(modalScreen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: chakra.registry,
      renderPass: chakra.renderPass?.(theme),
    });
    // The modal surface + all its content render inline. Chakra's own Modal
    // portals and SSRs to NOTHING — the canvas-safe shims render a surface.
    expect(bodyHtml).toContain("Delete item?");
    expect(bodyHtml).toContain("This is permanent.");
    expect(bodyHtml).toContain("Delete");
    // No portal machinery / fixed backdrop (the shims drop them).
    expect(bodyHtml).not.toContain("chakra-portal");
    expect(bodyHtml).not.toContain("chakra-modal__overlay");
  });

  test("trigger overlays (Menu) render the trigger + the pinned-open surface", async () => {
    const menuScreen: Screen = {
      id: "m",
      name: "M",
      tree: {
        $ref: "Menu",
        children: [
          { $ref: "MenuButton", props: { children: "Actions" } },
          {
            $ref: "MenuList",
            children: [
              { $ref: "MenuItem", props: { children: "Edit" } },
              { $ref: "MenuDivider" },
              { $ref: "MenuItem", props: { children: "Delete" } },
            ],
          },
        ],
      },
    };
    const { bodyHtml } = await renderScreen(menuScreen, theme, {
      viewport: { w: 400, h: 300 },
      snapshotCss: "",
      registry: chakra.registry,
      renderPass: chakra.renderPass?.(theme),
    });
    expect(bodyHtml).toContain("Actions"); // the trigger renders inline
    expect(bodyHtml).toContain("Edit"); // the menu surface is pinned open
    expect(bodyHtml).toContain("Delete");
  });

  test("emits chakra-native code; velloo helpers (Icon) emit lucide, not chakra", async () => {
    // Mirrors what the emit_code tool's targetFor() builds — only chakra-source ids.
    expect(chakra.codegenModule).toBe("@chakra-ui/react");
    const manifest = await chakra.loadManifest();
    const target = moduleTarget(
      manifest.filter((c) => c.source !== "velloo").map((c) => c.id),
      chakra.codegenModule ?? "",
    );
    const styledScreen: Screen = {
      ...screen,
      tree: {
        $ref: "Card",
        props: { variant: "outline", sx: { p: 6 } },
        children: [
          { $ref: "Heading", props: { size: "lg", children: "Hi" } },
          { $ref: "Icon", props: { name: "ArrowRight", size: 18 } },
        ],
      },
    };
    const result = unwrap(await emitCode(styledScreen, { target }));
    expect(result.jsx).toContain("<Card");
    expect(result.jsx).toContain("<Heading");
    // The sx channel serializes verbatim as an sx object.
    expect(result.jsx).toContain("sx={{ p: 6 }}");
    // Icon (a velloo helper) lowers to the lucide JSX tag, NOT a chakra import.
    expect(result.jsx).toContain("<ArrowRight");
    expect(result.iconsUsed).toContain("ArrowRight");
    // No shadcn install plan on a native framework.
    expect(result.componentsToInstall).toEqual([]);
  });

  test("emit_theme produces an extendTheme module from the SAME mapping as the render", async () => {
    const adapter = chakra as FrameworkAdapter;
    expect(adapter.themeToNative).toBeDefined();
    if (!adapter.themeModule) throw new Error("chakra adapter must declare themeModule");
    const { files } = await emitNativeTheme(adapter.themeToNative?.(theme), {
      spec: adapter.themeModule,
      outputDir: "/tmp/velloo-chakra-theme",
      apply: false,
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.path.endsWith("chakra-theme.ts")).toBe(true);
    const out = files[0]?.contents ?? "";
    expect(out).toContain('import { extendTheme } from "@chakra-ui/react"');
    // factory: "extendTheme" ⇒ the options wrap in the factory call.
    expect(out).toContain("export const theme = extendTheme({");
    // Same tokens that reach the rendered components reach the artifact:
    expect(out).toContain('"500": "#4f46e5"'); // primary verbatim at brand.500
    expect(out).toContain('"chakra-body-bg": "#ffffff"');
    expect(out).toContain('md: "12px"');
    expect(out).toContain('initialColorMode: "light"');
    // Idiomatic JS literal (bare identifier keys), not JSON.
    expect(out).not.toContain('"initialColorMode":');
  });
});

// --- the full-registry SSR sweep --------------------------------------------

/**
 * Minimal valid compositions covering EVERY registry id. Chakra sub-parts
 * (CardBody, Th, TabPanel, StatArrow, …) read context their real parent
 * provides and THROW standalone — so each id must appear here inside a
 * working composition, and the coverage test fails when a new registry id
 * isn't added to the sweep.
 */
const SWEEP_TREES: Screen["tree"][] = [
  {
    $ref: "Container",
    props: { maxW: "3xl" },
    children: [
      {
        $ref: "Stack",
        props: { spacing: 4 },
        children: [
          { $ref: "Heading", props: { size: "lg", children: "Sweep" } },
          { $ref: "Text", props: { children: "body" } },
          {
            $ref: "HStack",
            props: { spacing: 3 },
            children: [
              { $ref: "Button", props: { colorScheme: "brand", children: "Go" } },
              {
                $ref: "IconButton",
                props: { "aria-label": "settings" },
                children: [{ $ref: "Icon", props: { name: "Settings", size: 16 } }],
              },
              { $ref: "Spacer" },
              { $ref: "Badge", props: { children: "New" } },
              { $ref: "Tag", props: { children: "Design" } },
            ],
          },
          {
            $ref: "Flex",
            props: { gap: 4 },
            children: [
              { $ref: "Avatar", props: { name: "Ada Lovelace" } },
              { $ref: "Skeleton", props: { height: "20px" } },
              { $ref: "Progress", props: { value: 62 } },
            ],
          },
          { $ref: "Divider" },
          {
            $ref: "Grid",
            props: { templateColumns: "repeat(2, 1fr)", gap: 4 },
            children: [
              { $ref: "GridItem", children: [{ $ref: "Box", props: { children: "cell" } }] },
              {
                $ref: "VStack",
                props: { spacing: 2 },
                children: [
                  { $ref: "Input", props: { placeholder: "Email" } },
                  { $ref: "Textarea", props: { placeholder: "More…" } },
                  { $ref: "Select", props: { placeholder: "Pick" } },
                  { $ref: "Checkbox", props: { children: "Remember" } },
                  { $ref: "Radio", props: { children: "Monthly" } },
                  { $ref: "Switch", props: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    $ref: "Card",
    children: [
      { $ref: "CardHeader", children: [{ $ref: "Heading", props: { size: "md", children: "T" } }] },
      { $ref: "CardBody", children: [{ $ref: "Text", props: { children: "b" } }] },
      { $ref: "CardFooter", children: [{ $ref: "Button", props: { children: "ok" } }] },
    ],
  },
  {
    $ref: "Alert",
    props: { status: "info" },
    children: [
      { $ref: "AlertIcon" },
      { $ref: "AlertTitle", props: { children: "Synced" } },
      { $ref: "AlertDescription", props: { children: "All saved." } },
    ],
  },
  {
    $ref: "Stat",
    children: [
      { $ref: "StatLabel", props: { children: "Users" } },
      { $ref: "StatNumber", props: { children: "42" } },
      {
        $ref: "StatHelpText",
        children: [{ $ref: "StatArrow", props: { type: "increase" } }],
      },
    ],
  },
  {
    $ref: "Slider",
    props: { value: 30, "aria-label": "volume" },
    children: [
      { $ref: "SliderTrack", children: [{ $ref: "SliderFilledTrack" }] },
      { $ref: "SliderThumb" },
    ],
  },
  {
    $ref: "TableContainer",
    children: [
      {
        $ref: "Table",
        children: [
          {
            $ref: "Thead",
            children: [{ $ref: "Tr", children: [{ $ref: "Th", props: { children: "Name" } }] }],
          },
          {
            $ref: "Tbody",
            children: [{ $ref: "Tr", children: [{ $ref: "Td", props: { children: "Ada" } }] }],
          },
        ],
      },
    ],
  },
  {
    $ref: "Tabs",
    props: { defaultIndex: 0 },
    children: [
      {
        $ref: "TabList",
        children: [
          { $ref: "Tab", props: { children: "A" } },
          { $ref: "Tab", props: { children: "B" } },
        ],
      },
      {
        $ref: "TabPanels",
        children: [
          { $ref: "TabPanel", props: { children: "pane a" } },
          { $ref: "TabPanel", props: { children: "pane b" } },
        ],
      },
    ],
  },
  { $ref: "List", children: [{ $ref: "ListItem", props: { children: "one" } }] },
  {
    $ref: "Breadcrumb",
    children: [
      {
        $ref: "BreadcrumbItem",
        children: [{ $ref: "BreadcrumbLink", props: { href: "#", children: "Home" } }],
      },
    ],
  },
  {
    $ref: "Modal",
    children: [
      { $ref: "ModalOverlay" },
      {
        $ref: "ModalContent",
        children: [
          { $ref: "ModalCloseButton" },
          { $ref: "ModalHeader", props: { children: "Delete?" } },
          { $ref: "ModalBody", props: { children: "sure?" } },
          { $ref: "ModalFooter", children: [{ $ref: "Button", props: { children: "Del" } }] },
        ],
      },
    ],
  },
  {
    $ref: "Drawer",
    children: [
      { $ref: "DrawerOverlay" },
      {
        $ref: "DrawerContent",
        children: [
          { $ref: "DrawerHeader", props: { children: "Filters" } },
          { $ref: "DrawerBody", props: { children: "body" } },
          { $ref: "DrawerFooter", props: { children: "footer" } },
        ],
      },
    ],
  },
  {
    $ref: "Popover",
    children: [
      { $ref: "PopoverTrigger", children: [{ $ref: "Button", props: { children: "Open" } }] },
      {
        $ref: "PopoverContent",
        children: [
          { $ref: "PopoverArrow" },
          { $ref: "PopoverHeader", props: { children: "H" } },
          { $ref: "PopoverBody", props: { children: "B" } },
        ],
      },
    ],
  },
  {
    $ref: "Menu",
    children: [
      { $ref: "MenuButton", props: { children: "Actions" } },
      {
        $ref: "MenuList",
        children: [{ $ref: "MenuItem", props: { children: "Edit" } }, { $ref: "MenuDivider" }],
      },
    ],
  },
  {
    $ref: "Tooltip",
    props: { label: "tip" },
    children: [{ $ref: "Button", props: { children: "hover" } }],
  },
  {
    $ref: "Layer",
    children: [
      { $ref: "Image", props: { src: "/assets/x.png", alt: "x" } },
      { $ref: "Placeholder", props: { label: "hero" } },
      { $ref: "SVG", props: { content: "<circle cx='5' cy='5' r='4'/>", viewBox: "0 0 10 10" } },
      { $ref: "Gradient", props: { from: "#4f46e5" } },
    ],
  },
  {
    $ref: "Prose",
    props: { preset: "docs" },
    children: [{ $ref: "Text", props: { children: "long-form copy" } }],
  },
];

function collectRefs(node: Screen["tree"], into: Set<string>): void {
  if (!("$ref" in node)) return; // snippet instances don't appear in the sweep
  into.add(node.$ref);
  for (const child of node.children ?? []) collectRefs(child, into);
}

describe("chakra full-registry SSR sweep", () => {
  test("the sweep covers every registry id (add new ids to SWEEP_TREES)", () => {
    const covered = new Set<string>();
    for (const tree of SWEEP_TREES) collectRefs(tree, covered);
    const registryIds = Object.keys(chakra.registry).sort();
    expect([...covered].sort()).toEqual(registryIds);
  });

  test("every sweep composition SSRs through the render pass", async () => {
    for (const [i, tree] of SWEEP_TREES.entries()) {
      const { bodyHtml } = await renderScreen(
        { id: `sweep-${i}`, name: `Sweep ${i}`, tree },
        theme,
        {
          viewport: { w: 1024, h: 768 },
          snapshotCss: "",
          registry: chakra.registry,
          renderPass: chakra.renderPass?.(theme),
        },
      );
      expect(bodyHtml.length).toBeGreaterThan(0);
    }
  });
});

describe("chakra typography projection", () => {
  const typeset: Theme = {
    ...theme,
    typography: {
      fontFamily: { sans: "Inter, sans-serif", display: "Fraunces, serif", mono: "Menlo" },
      typesets: { default: { size: 18, leading: 1.6, fontBody: "sans", fontHeading: "display" } },
    },
  };

  test("the default typeset drives fontSizes/lineHeights, keyed by role", () => {
    const native = chakra.themeToNative?.(typeset, false) as {
      fontSizes: Record<string, string>;
      lineHeights: Record<string, number>;
      fontWeights: Record<string, number>;
    };
    const scale = typesetScale(typeset.typography.typesets?.default);
    expect(native.fontSizes.body).toBe(`${scale.body.fontSize}px`);
    expect(native.fontSizes.h1).toBe(`${scale.h1.fontSize}px`);
    expect(native.lineHeights.h1).toBe(scale.h1.lineHeight);
    expect(native.fontWeights.h1).toBe(700);
    // Every role in the ladder is projected, not a hand-picked subset.
    for (const role of TYPESET_SCALE_NAMES) expect(native.fontSizes[role]).toBeDefined();
  });

  test("the heading face is the typeset's heading role, not the body font", () => {
    const native = chakra.themeToNative?.(typeset, false) as {
      fonts: { heading: string; body: string; mono?: string };
    };
    expect(native.fonts.heading).toBe("Fraunces, serif");
    expect(native.fonts.body).toBe("Inter, sans-serif");
    expect(native.fonts.mono).toBe("Menlo");
  });

  test("a folder with no typesets still gets the baseline ladder and the sans face", () => {
    const native = chakra.themeToNative?.(theme, false) as {
      fonts: { heading: string; body: string };
      fontSizes: Record<string, string>;
    };
    expect(native.fonts.heading).toBe("Inter, sans-serif");
    expect(native.fontSizes.body).toBe("16px");
    expect(native.fontSizes.h1).toBe("40px");
  });
});

describe("chakra dark mode", () => {
  const themed: Theme = {
    ...theme,
    colorsDark: {
      background: "#0b0b0f",
      foreground: "#f5f5f5",
      primary: { DEFAULT: "#a5b4fc", foreground: "#0b0b0f" },
    },
  };

  test("themeToNative(dark) merges colorsDark into REAL values, not just a mode flag", () => {
    const light = chakra.themeToNative?.(themed, false) as {
      config: { initialColorMode: string };
      colors: { brand: Record<string, string> };
      semanticTokens: { colors: Record<string, string> };
    };
    const dark = chakra.themeToNative?.(themed, true) as typeof light;
    expect(light.config.initialColorMode).toBe("light");
    expect(dark.config.initialColorMode).toBe("dark");
    // The dark background must be the REAL dark surface, NOT the light
    // #ffffff under a flipped mode.
    expect(light.semanticTokens.colors["chakra-body-bg"]).toBe("#ffffff");
    expect(dark.semanticTokens.colors["chakra-body-bg"]).toBe("#0b0b0f");
    expect(dark.semanticTokens.colors["chakra-body-text"]).toBe("#f5f5f5");
    // The brand scale re-derives from the dark primary (verbatim at 500).
    expect(light.colors.brand["500"]).toBe("#4f46e5");
    expect(dark.colors.brand["500"]).toBe("#a5b4fc");
  });

  test("oklch theme colors project to chakra-parsable rgb/hex (culori)", () => {
    const oklchTheme: Theme = {
      ...theme,
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.6 0.2 275)", foreground: "oklch(0.98 0 0)" },
      },
    };
    const native = chakra.themeToNative?.(oklchTheme, false) as {
      colors: { brand: Record<string, string> };
      semanticTokens: { colors: Record<string, string> };
    };
    // Chakra's color engine can't parse oklch — the projection must hand it
    // rgb (verbatim slots) / hex (derived scale steps).
    expect(native.semanticTokens.colors["chakra-body-bg"]).toMatch(/^rgb\(/);
    expect(native.colors.brand["500"]).toMatch(/^rgb\(/);
    expect(native.colors.brand["100"]).toMatch(/^#/);
    expect(native.colors.brand["700"]).toMatch(/^#/);
  });

  test("emitNativeTheme emits a darkTheme alongside theme when colorsDark is set", async () => {
    const spec = (chakra as FrameworkAdapter).themeModule;
    if (!spec) throw new Error("chakra adapter must declare themeModule");
    const result = await emitNativeTheme(chakra.themeToNative?.(themed, false), {
      spec,
      outputDir: "/tmp/velloo-chakra-dark-test",
      darkThemeOptions: chakra.themeToNative?.(themed, true),
      apply: false,
    });
    const out = result.files[0]?.contents ?? "";
    expect(out).toContain("export const theme = extendTheme({");
    expect(out).toContain("export const darkTheme = extendTheme({");
    expect(out).toContain('initialColorMode: "dark"');
    expect(out).toContain('"chakra-body-bg": "#0b0b0f"');
  });

  test("a dark render pass SSRs real dark surfaces", async () => {
    const { html } = await renderScreen(screen, themed, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: chakra.registry,
      renderPass: chakra.renderPass?.(themed, true),
    });
    // The dark body-bg reached the extracted globals, and the light value is gone.
    expect(html).toMatch(/--chakra-colors-chakra-body-bg:\s*#0b0b0f/i);
    expect(html).not.toMatch(/--chakra-colors-chakra-body-bg:\s*#ffffff/i);
    // The dark brand primary reached the sheet too.
    expect(html).toContain("#a5b4fc");
  });
});
