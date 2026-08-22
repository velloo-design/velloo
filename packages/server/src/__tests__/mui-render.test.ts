import { describe, expect, test } from "bun:test";
import { emitCode, emitMuiTheme, moduleTarget } from "@velloo/codegen";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider } from "@velloo/provider-mui";
import { renderScreen } from "@velloo/renderer";
import { unwrap } from "@velloo/result";
import type { Screen, Theme } from "@velloo/schema";

/**
 * The framework-native milestone: a MUI-native screen SSRs to REAL MUI markup
 * with its emotion styles captured — in-process, no client bundle. Proves the
 * adapter's registry + emotion renderPass work end-to-end through the renderer.
 */

const mui = createProvider();

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
    props: { variant: "outlined" },
    children: [
      {
        $ref: "CardContent",
        children: [
          { $ref: "Typography", props: { variant: "h5", children: "Hello MUI" } },
          { $ref: "Button", props: { variant: "contained", color: "primary", children: "Go" } },
        ],
      },
    ],
  },
};

describe("MUI adapter SSR", () => {
  test("renders real MUI components + extracts emotion CSS", async () => {
    const { html, bodyHtml } = await renderScreen(screen, theme, {
      viewport: { w: 1280, h: 800 },
      snapshotCss: "",
      registry: mui.registry,
      renderPass: mui.renderPass?.(theme),
    });
    // Real MUI components rendered (their stable class names + content).
    expect(bodyHtml).toContain("MuiCard-root");
    expect(bodyHtml).toContain("MuiButton-root");
    expect(bodyHtml).toContain("MuiButton-contained");
    expect(bodyHtml).toContain("Hello MUI");
    expect(bodyHtml).toContain("Go");
    // The emotion render pass injected a tagged style block with real rules
    // (the cache key "vmui" prefixes the generated classes).
    expect(html).toContain("data-velloo-adapter");
    expect(html).toMatch(/\.vmui-[\w-]+\s*\{/); // emotion rule(s) extracted
    // velloo theme tokens projected onto MUI: primary + radius reached the components.
    expect(html).toContain("#4f46e5");
    expect(html).toContain("border-radius:12px");
  });

  test("adapter declares the sx style channel (not Tailwind)", () => {
    expect(mui.styleChannel?.kind).toBe("sx");
    expect(mui.styleChannel?.needsTailwindJit).toBe(false);
  });

  test("MUI folders get the velloo Icon helper (MUI bundles no icon set)", async () => {
    const iconScreen: Screen = {
      id: "i",
      name: "I",
      tree: {
        $ref: "Button",
        props: { variant: "contained" },
        children: [{ $ref: "Icon", props: { name: "ArrowRight", size: 18 } }],
      },
    };
    const { bodyHtml } = await renderScreen(iconScreen, theme, {
      viewport: { w: 400, h: 200 },
      snapshotCss: "",
      registry: mui.registry,
      renderPass: mui.renderPass?.(theme),
    });
    expect(bodyHtml).toContain("MuiButton-root"); // real MUI button
    expect(bodyHtml).toContain("<svg"); // the lucide icon rendered (sized via `size`, not Tailwind)
    expect(bodyHtml).toContain('width="18"');
    // The manifest surfaces Icon so list_components shows it.
    const manifest = await mui.loadManifest();
    expect(manifest.find((c) => c.id === "Icon")).toBeDefined();
  });

  test("catalog() reports every manifest component installed from @mui/material", async () => {
    const catalog = (await mui.catalog?.()) ?? [];
    expect(catalog.length).toBeGreaterThan(20);
    const button = catalog.find((e) => e.id === "Button");
    expect(button?.installed).toBe(true); // the whole MUI set is bundled
    expect(button?.importPath).toBe("@mui/material");
    expect(button?.renderStrategy).toBe("library");
    // Every entry carries its descriptor (so list/install can show props).
    expect(catalog.every((e) => e.descriptor.id === e.id)).toBe(true);
  });

  test("overlay components render open + inline (Dialog content is visible in SSR)", async () => {
    const dialogScreen: Screen = {
      id: "d",
      name: "D",
      tree: {
        $ref: "Dialog",
        props: { maxWidth: "sm" },
        children: [
          { $ref: "DialogTitle", props: { children: "Delete item?" } },
          {
            $ref: "DialogContent",
            children: [{ $ref: "DialogContentText", props: { children: "This is permanent." } }],
          },
          {
            $ref: "DialogActions",
            children: [{ $ref: "Button", props: { variant: "contained", children: "Delete" } }],
          },
        ],
      },
    };
    const { bodyHtml } = await renderScreen(dialogScreen, theme, {
      viewport: { w: 800, h: 600 },
      snapshotCss: "",
      registry: mui.registry,
      renderPass: mui.renderPass?.(theme),
    });
    // The dialog surface + all its content render inline (no portal stripped it away).
    expect(bodyHtml).toContain("MuiPaper-root");
    expect(bodyHtml).toContain("Delete item?");
    expect(bodyHtml).toContain("This is permanent.");
    expect(bodyHtml).toContain("Delete");
    // No fixed modal backdrop (the canvas-safe shim drops it).
    expect(bodyHtml).not.toContain("MuiBackdrop-root");
  });

  test("emits MUI-native code; velloo helpers (Icon) emit lucide, not @mui/material", async () => {
    // Mirrors what the emit_code tool's targetFor() builds — only MUI-source ids.
    expect(mui.codegenModule).toBe("@mui/material");
    const manifest = await mui.loadManifest();
    const target = moduleTarget(
      manifest.filter((c) => c.source !== "velloo").map((c) => c.id),
      mui.codegenModule ?? "",
    );
    const sxScreen: Screen = {
      ...screen,
      tree: {
        $ref: "Card",
        props: { variant: "outlined", sx: { p: 3 } },
        children: [{ $ref: "Icon", props: { name: "ArrowRight", size: 18 } }],
      },
    };
    const result = unwrap(await emitCode(sxScreen, { target }));
    expect(result.jsx).toContain("<Card variant=");
    // Icon (a velloo helper) lowers to the lucide JSX tag, NOT a MUI import.
    expect(result.jsx).toContain("<ArrowRight");
    expect(result.iconsUsed).toContain("ArrowRight");
    // No shadcn install plan on a native framework.
    expect(result.componentsToInstall).toEqual([]);
  });

  test("emit_theme produces a createTheme module from the SAME mapping as the render", async () => {
    const adapter = mui as FrameworkAdapter;
    expect(adapter.themeToNative).toBeDefined();
    const native = adapter.themeToNative?.(theme);
    const { files } = await emitMuiTheme(native, {
      outputDir: "/tmp/velloo-mui-theme",
      apply: false,
    });
    expect(files).toHaveLength(1);
    const out = files[0]?.contents ?? "";
    expect(out).toContain('import { createTheme } from "@mui/material/styles"');
    expect(out).toContain("export const theme = createTheme(");
    // Same tokens that reach the rendered components reach the artifact:
    expect(out).toContain('main: "#4f46e5"'); // primary base → palette.primary.main
    expect(out).toContain("borderRadius: 12"); // radius.md → shape.borderRadius
    // Idiomatic JS literal (bare identifier keys), not JSON.
    expect(out).not.toContain('"main":');
  });
});
