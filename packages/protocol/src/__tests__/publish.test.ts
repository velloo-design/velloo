import { describe, expect, test } from "bun:test";
import {
  DESIGN_BUNDLE_FORMAT,
  DesignBundleSchema,
  FrozenScreenSchema,
  frozenVariantKey,
} from "../publish.ts";
import { bundleFormatOf, DesignBundleMetaSchema } from "../publish-meta.ts";

const bundle = {
  formatVersion: DESIGN_BUNDLE_FORMAT,
  title: "Designs",
  viewport: { w: 1440, h: 900 },
  defaultLibrary: "default",
  libraries: {
    default: { id: "none", version: "1", source: "binary", componentsPath: "binary" },
  },
  extensions: {},
  viewportPresets: [],
  theme: {
    name: "default",
    colors: { background: "#fff", foreground: "#111", primary: "#333" },
    typography: {},
    spacing: {},
    radius: {},
  },
  themes: {},
  customCss: "",
  snippets: [],
  screens: [
    {
      id: "home",
      name: "Home",
      tree: { $ref: "Box", children: [{ $text: "Remote " }, { $ref: "Box" }] },
    },
  ],
  boards: [],
  annotations: {},
  notes: {},
  live: false,
  snapshotCssPath: "snapshot.css",
};

describe("the publish bundle", () => {
  test("is format 2: a viewer that can't draw text nodes or frozen screens must refuse it", () => {
    expect(DESIGN_BUNDLE_FORMAT).toBe(2);
    // The cloud reads the stamp through its own projection, and compares.
    expect(bundleFormatOf(DesignBundleMetaSchema.parse(bundle))).toBe(2);
    expect(DesignBundleSchema.safeParse({ ...bundle, formatVersion: 1 }).success).toBe(false);
  });

  test("carries what makes a share the canvas: the app's stylesheet and frozen screens", () => {
    const parsed = DesignBundleSchema.safeParse({
      ...bundle,
      appStylesheets: { home: "app-1k2j3.css" },
      frozenScreens: {
        home: {
          [frozenVariantKey("default", "light")]: "frozen/abc123.json",
          [frozenVariantKey("default", "dark")]: "frozen/abc123.json",
        },
      },
    });
    expect(parsed.success).toBe(true);
    expect(frozenVariantKey("brand", "dark")).toBe("brand/dark");
  });

  test("names only files of the bundle's own, by the shape publish writes", () => {
    // The viewer fetches these paths. One that points anywhere else is refused
    // here, before it is ever a URL.
    for (const appStylesheets of [
      { home: "../secrets.css" },
      { home: "https://evil.example/a.css" },
      { home: "assets/host/app.css" },
    ]) {
      expect(DesignBundleSchema.safeParse({ ...bundle, appStylesheets }).success).toBe(false);
    }
    for (const path of ["frozen/../design.json", "/frozen/a.json", "frozen/a.html"]) {
      const frozenScreens = { home: { "default/light": path } };
      expect(DesignBundleSchema.safeParse({ ...bundle, frozenScreens }).success).toBe(false);
    }
  });

  test("a frozen screen is its stylesheets and its markup, and nothing else", () => {
    expect(
      FrozenScreenSchema.safeParse({ head: "<style></style>", body: "<main></main>" }).success,
    ).toBe(true);
    expect(FrozenScreenSchema.safeParse({ head: "", body: "", script: "alert(1)" }).success).toBe(
      false,
    );
  });
});
