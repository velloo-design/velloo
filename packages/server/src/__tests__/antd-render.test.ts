import { describe, expect, test } from "bun:test";
import { emitCode, emitNativeTheme, moduleTarget } from "@velloo/codegen";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider } from "@velloo/provider-antd";
import { renderScreen } from "@velloo/renderer";
import { unwrap } from "@velloo/result";
import type { Screen, Theme } from "@velloo/schema";

/**
 * The antd twin of mui-render.test.ts: an antd-native screen SSRs to REAL antd
 * markup with its cssinjs styles captured — in-process, no client bundle.
 * Proves the adapter's registry + cssinjs renderPass work end-to-end through
 * the renderer.
 */

const antd = createProvider();

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
    props: { title: "Team" },
    children: [
      { $ref: "TypographyTitle", props: { level: 3, children: "Hello antd" } },
      { $ref: "Button", props: { type: "primary", children: "Go" } },
    ],
  },
};

describe("antd adapter SSR", () => {
  test("renders real antd components + extracts cssinjs styles", async () => {
    const { html, bodyHtml } = await renderScreen(screen, theme, {
      viewport: { w: 1280, h: 800 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(theme),
    });
    // Real antd components rendered (their stable class names + content).
    expect(bodyHtml).toContain("ant-card");
    expect(bodyHtml).toContain("ant-btn");
    expect(bodyHtml).toContain("ant-btn-primary");
    expect(bodyHtml).toContain("Hello antd");
    expect(bodyHtml).toContain("Go");
    // The cssinjs render pass injected a tagged style block with real rules.
    expect(html).toContain("data-velloo-adapter");
    expect(html).toMatch(/\.ant-btn[\s\S]*\{/); // antd rule(s) extracted
    // velloo theme tokens projected onto antd: primary + radius reached the
    // sheet, and cssVar mode published them as --ant-* variables so inline
    // `style` objects (this provider's channel) can reference theme values.
    expect(html).toContain("#4f46e5");
    expect(html).toMatch(/--ant-border-radius:\s*12px/);
    expect(html).toContain("--ant-color-primary");
  });

  test("adapter declares the inline style channel (not Tailwind, no sx)", () => {
    expect(antd.styleChannel?.kind).toBe("style");
    expect(antd.styleChannel?.needsTailwindJit).toBe(false);
    expect(antd.styleChannels).toEqual(["style"]);
  });

  test("antd folders get the velloo Icon helper (antd's icon set isn't surfaced)", async () => {
    const iconScreen: Screen = {
      id: "i",
      name: "I",
      tree: {
        $ref: "Button",
        props: { type: "primary" },
        children: [{ $ref: "Icon", props: { name: "ArrowRight", size: 18 } }],
      },
    };
    const { bodyHtml } = await renderScreen(iconScreen, theme, {
      viewport: { w: 400, h: 200 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(theme),
    });
    expect(bodyHtml).toContain("ant-btn"); // real antd button
    expect(bodyHtml).toContain("<svg"); // the lucide icon rendered (sized via `size`, not Tailwind)
    expect(bodyHtml).toContain('width="18"');
    // The manifest surfaces Icon so list_components shows it.
    const manifest = await antd.loadManifest();
    expect(manifest.find((c) => c.id === "Icon")).toBeDefined();
  });

  test("catalog() reports every manifest component installed from antd", async () => {
    const catalog = (await antd.catalog?.()) ?? [];
    expect(catalog.length).toBeGreaterThan(20);
    const button = catalog.find((e) => e.id === "Button");
    expect(button?.installed).toBe(true); // the whole curated antd set is bundled
    expect(button?.importPath).toBe("antd");
  });

  test("overlay components render open + inline (Modal content is visible in SSR)", async () => {
    const modalScreen: Screen = {
      id: "d",
      name: "D",
      tree: {
        $ref: "Modal",
        props: { title: "Delete item?" },
        children: [
          { $ref: "TypographyParagraph", props: { children: "This is permanent." } },
          { $ref: "Button", props: { danger: true, children: "Delete" } },
        ],
      },
    };
    const { bodyHtml } = await renderScreen(modalScreen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(theme),
    });
    // The modal surface + all its content render inline. antd's own Modal
    // portals and SSRs to NOTHING — the canvas-safe shim renders a surface.
    expect(bodyHtml).toContain("ant-card");
    expect(bodyHtml).toContain("Delete item?");
    expect(bodyHtml).toContain("This is permanent.");
    expect(bodyHtml).toContain("Delete");
    // No portal machinery / fixed backdrop (the shim drops it).
    expect(bodyHtml).not.toContain("ant-modal-mask");
    expect(bodyHtml).not.toContain("ant-modal-root");
  });

  test("trigger overlays (Dropdown) render the trigger + the pinned-open surface", async () => {
    const dropScreen: Screen = {
      id: "dd",
      name: "DD",
      tree: {
        $ref: "Dropdown",
        props: {
          menu: {
            items: [
              { key: "edit", label: "Edit" },
              { key: "delete", label: "Delete" },
            ],
          },
        },
        children: [{ $ref: "Button", props: { children: "Actions" } }],
      },
    };
    const { bodyHtml } = await renderScreen(dropScreen, theme, {
      viewport: { w: 400, h: 300 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(theme),
    });
    expect(bodyHtml).toContain("Actions"); // the trigger child renders inline
    expect(bodyHtml).toContain("Edit"); // the menu surface is pinned open
    expect(bodyHtml).toContain("ant-menu");
  });

  test("emits antd-native code; velloo helpers (Icon) emit lucide, not antd", async () => {
    // Mirrors what the emit_code tool's targetFor() builds — only antd-source ids.
    expect(antd.codegenModule).toBe("antd");
    const manifest = await antd.loadManifest();
    const target = moduleTarget(
      manifest.filter((c) => c.source !== "velloo").map((c) => c.id),
      antd.codegenModule ?? "",
    );
    const styledScreen: Screen = {
      ...screen,
      tree: {
        $ref: "Card",
        props: { title: "Team", style: { padding: 24 } },
        children: [
          { $ref: "TypographyTitle", props: { level: 3, children: "Hi" } },
          { $ref: "Icon", props: { name: "ArrowRight", size: 18 } },
        ],
      },
    };
    const result = unwrap(await emitCode(styledScreen, { target }));
    expect(result.jsx).toContain("<Card");
    expect(result.jsx).toContain("<TypographyTitle");
    // The style channel serializes verbatim as an inline style object.
    expect(result.jsx).toContain("style={{ padding: 24 }}");
    // Icon (a velloo helper) lowers to the lucide JSX tag, NOT an antd import.
    expect(result.jsx).toContain("<ArrowRight");
    expect(result.iconsUsed).toContain("ArrowRight");
    // No shadcn install plan on a native framework.
    expect(result.componentsToInstall).toEqual([]);
  });

  test("emit_theme produces a ThemeConfig module from the SAME mapping as the render", async () => {
    const adapter = antd as FrameworkAdapter;
    expect(adapter.themeToNative).toBeDefined();
    if (!adapter.themeModule) throw new Error("antd adapter must declare themeModule");
    const { files } = await emitNativeTheme(adapter.themeToNative?.(theme), {
      spec: adapter.themeModule,
      outputDir: "/tmp/velloo-antd-theme",
      apply: false,
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.path.endsWith("antd-theme.ts")).toBe(true);
    const out = files[0]?.contents ?? "";
    expect(out).toContain('import { theme as antdTheme } from "antd"');
    // factory: null ⇒ a bare ThemeConfig object literal, not a factory call.
    expect(out).toContain("export const theme = {");
    // The algorithm emits as a bare identifier the import line brings into scope.
    expect(out).toContain("algorithm: antdTheme.defaultAlgorithm");
    // Same tokens that reach the rendered components reach the artifact:
    expect(out).toContain('colorPrimary: "#4f46e5"');
    expect(out).toContain("borderRadius: 12");
    expect(out).toContain("cssVar: true");
    // Idiomatic JS literal (bare identifier keys), not JSON.
    expect(out).not.toContain('"colorPrimary":');
  });
});

describe("antd dark mode", () => {
  const themed: Theme = {
    ...theme,
    colorsDark: {
      background: "#0b0b0f",
      foreground: "#f5f5f5",
      primary: { DEFAULT: "#a5b4fc", foreground: "#0b0b0f" },
    },
  };

  test("themeToNative(dark) merges colorsDark + the dark algorithm, not just a flag", () => {
    const light = antd.themeToNative?.(themed, false) as {
      token: { colorBgBase: string; colorPrimary: string };
      algorithm: { $identifier: string };
    };
    const dark = antd.themeToNative?.(themed, true) as {
      token: { colorBgBase: string; colorPrimary: string };
      algorithm: { $identifier: string };
    };
    expect(light.algorithm.$identifier).toBe("antdTheme.defaultAlgorithm");
    expect(dark.algorithm.$identifier).toBe("antdTheme.darkAlgorithm");
    // The dark background must be the REAL dark surface, NOT the light
    // #ffffff under a flipped algorithm.
    expect(light.token.colorBgBase).toBe("#ffffff");
    expect(dark.token.colorBgBase).toBe("#0b0b0f");
    expect(dark.token.colorPrimary).toBe("#a5b4fc");
  });

  test("oklch theme colors project to antd-parsable rgb (culori)", () => {
    const oklchTheme: Theme = {
      ...theme,
      colors: {
        background: "oklch(1 0 0)",
        foreground: "oklch(0.145 0 0)",
        primary: { DEFAULT: "oklch(0.6 0.2 275)", foreground: "oklch(0.98 0 0)" },
      },
    };
    const native = antd.themeToNative?.(oklchTheme, false) as {
      token: { colorPrimary: string; colorBgBase: string };
    };
    // antd's color engine can't parse oklch — the projection must hand it rgb.
    expect(native.token.colorPrimary).toMatch(/^rgb\(/);
    expect(native.token.colorBgBase).toMatch(/^rgb\(/);
  });

  test("emitNativeTheme emits a darkTheme alongside theme when colorsDark is set", async () => {
    const spec = (antd as FrameworkAdapter).themeModule;
    if (!spec) throw new Error("antd adapter must declare themeModule");
    const result = await emitNativeTheme(antd.themeToNative?.(themed, false), {
      spec,
      outputDir: "/tmp/velloo-antd-dark-test",
      darkThemeOptions: antd.themeToNative?.(themed, true),
      apply: false,
    });
    const out = result.files[0]?.contents ?? "";
    expect(out).toContain("export const theme = {");
    expect(out).toContain("export const darkTheme = {");
    expect(out).toContain("algorithm: antdTheme.darkAlgorithm");
    expect(out).toContain('colorBgBase: "#0b0b0f"');
  });

  test("a dark render pass SSRs real dark surfaces", async () => {
    const { html } = await renderScreen(screen, themed, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: antd.registry,
      renderPass: antd.renderPass?.(themed, true),
    });
    // The dark colorBgBase reached the extracted sheet.
    expect(html).toContain("#0b0b0f");
    expect(html).not.toMatch(/--ant-color-bg-base:\s*#ffffff/);
  });
});
