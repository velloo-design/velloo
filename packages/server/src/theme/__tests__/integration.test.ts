import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { themeToCss } from "@velloo/renderer";
import { unwrap } from "@velloo/result";
import { type Theme, typesetScale } from "@velloo/schema";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { designConfig, designTheme } from "../../testing/design-folder.ts";

import type { WatchEvent } from "../../watcher.ts";
import {
  applyPreset,
  derivePaletteFromColor,
  setFonts,
  setToken,
  setTokens,
  setTypeset,
  type ThemeContext,
  withThemeLock,
} from "../index.ts";

const sampleConfig = designConfig({
  library: { componentsPath: "components/ui" },
  viewportPresets: [{ name: "Mobile", w: 390, h: 844 }],
});
const sampleTheme = designTheme({
  colors: { primary: { DEFAULT: "oklch(0.205 0 0)", foreground: "oklch(0.985 0 0)" } },
});
const sampleScreen = {
  id: "onboarding",
  name: "Onboarding",
  tree: { $ref: "Card", children: [{ $ref: "Heading", props: { level: 1 } }] },
};

let tmp: string;
let folder: DesignFolder;
let ctx: ThemeContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function diskTheme(): Promise<Theme> {
  return JSON.parse(await readFile(join(tmp, "theme/default.json"), "utf8")) as Theme;
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-theme-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/onboarding.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = { folder, broadcast: (e) => events.push(e) };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("applyPreset", () => {
  test("switches to violet and persists", async () => {
    const t = unwrap(await applyPreset(ctx, "violet"));
    expect(t.name).toBe("violet");
    const onDisk = await diskTheme();
    expect(onDisk.name).toBe("violet");
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({
      type: "theme-changed",
    });
  });

  test("returns UnknownPreset err on unknown preset", async () => {
    const r = await applyPreset(ctx, "neonpunk");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("UnknownPreset");
  });
});

describe("setToken", () => {
  test("updates a leaf and persists", async () => {
    unwrap(await setToken(ctx, "colors.background", "oklch(0.99 0 0)"));
    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("oklch(0.99 0 0)");
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({
      type: "theme-changed",
    });
  });

  test("rejects a path that produces an invalid theme", async () => {
    const r = await setToken(ctx, "colors.primary.DEFAULT", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidThemePath");
  });
});

describe("setTypeset", () => {
  test("merges fields, so tuning one control keeps the others", async () => {
    unwrap(await setTypeset(ctx, [{ leading: 1.9, flow: "2em" }]));
    unwrap(await setTypeset(ctx, [{ leading: 1.5 }]));
    const typesets = (await diskTheme()).typography.typesets;
    expect(typesets?.default).toEqual({ leading: 1.5, flow: "2em" });
    expect(events.filter((e) => e.type !== "activity").at(-1)).toEqual({ type: "theme-changed" });
  });

  test("null clears a field back to the baseline", async () => {
    unwrap(await setTypeset(ctx, [{ size: 15, leading: 1.6 }]));
    unwrap(await setTypeset(ctx, [{ size: null }]));
    expect((await diskTheme()).typography.typesets?.default).toEqual({ leading: 1.6 });
  });

  test("a named typeset becomes a preset alongside the default", async () => {
    unwrap(await setTypeset(ctx, [{ leading: 1.75 }, { name: "compact", size: 14, leading: 1.5 }]));
    const typesets = (await diskTheme()).typography.typesets;
    expect(Object.keys(typesets ?? {}).sort()).toEqual(["compact", "default"]);
  });

  test("rejects a name that is not selector-safe", async () => {
    const r = await setTypeset(ctx, [{ name: "bad name", size: 14 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidThemePath");
  });

  test("rejects a font role that set_fonts never declared", async () => {
    const r = await setTypeset(ctx, [{ fontHeading: "display" }]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidThemePath") {
      expect(r.error.reason).toContain("not a declared font role");
    } else {
      throw new Error("expected an InvalidThemePath error");
    }
  });

  test("accepts a font role once it exists", async () => {
    unwrap(await setFonts(ctx, [{ role: "display", family: "Unbounded" }]));
    unwrap(await setTypeset(ctx, [{ fontHeading: "display" }]));
    expect((await diskTheme()).typography.typesets?.default?.fontHeading).toBe("display");
  });

  test("rejects a font role that collides with the type scale", async () => {
    unwrap(await setFonts(ctx, [{ role: "body", family: "Inter" }]));
    const r = await setTypeset(ctx, [{ fontBody: "body" }]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidThemePath") {
      expect(r.error.reason).toContain("collides with the type scale");
    } else {
      throw new Error("expected an InvalidThemePath error");
    }
  });

  test("rejects a non-positive leading", async () => {
    const r = await setTypeset(ctx, [{ leading: 0 }]);
    expect(r.ok).toBe(false);
  });

  // The point of the whole design: one rhythm change moves what renders.
  test("a rhythm change moves the rendered CSS and the native theme together", async () => {
    const before = themeToCss(await diskTheme());
    expect(before).toContain("--typeset-leading: 1.75");

    unwrap(await setTypeset(ctx, [{ size: 20, leading: 1.4 }]));
    const theme = await diskTheme();

    const after = themeToCss(theme);
    expect(after).toContain("--typeset-size: 20px");
    expect(after).toContain("--typeset-leading: 1.4");
    // Derived, not restated — the ladder still references the controls.
    expect(after).toContain("--text-h1: calc(var(--typeset-rhythm) * 2.5)");

    // The same controls resolved for a native framework theme.
    const scale = typesetScale(theme.typography.typesets?.default);
    expect(scale.body.fontSize).toBe(20);
    expect(scale.h1.fontSize).toBe(50);
    expect(scale.body.lineHeight).toBeCloseTo(1.4, 3);

    // …and a real adapter picks it up, so a folder on MUI re-rhythms too.
    const mui = createMuiProvider().themeToNative?.(theme, false) as {
      typography: Record<string, { fontSize?: string }>;
    };
    expect(mui.typography.h1?.fontSize).toBe("50px");
    expect(mui.typography.body1?.fontSize).toBe("20px");
  });

  test("a preset overrides only the controls, so the ladder re-derives per region", async () => {
    unwrap(await setTypeset(ctx, [{ name: "compact", size: 14, leading: 1.4 }]));
    const css = themeToCss(await diskTheme());
    expect(css).toContain(".typeset-compact {");
    // A preset block carries the authored controls…
    const preset = css.slice(css.indexOf(".typeset-compact {"));
    const block = preset.slice(0, preset.indexOf("}"));
    expect(block).toContain("--typeset-size: 14px");
    // …and NOT the derived scale: re-declaring it there would freeze the ladder
    // at the base rhythm instead of re-substituting against the override.
    expect(block).not.toContain("--text-h1");
  });

  test("renaming a preset carries its authored controls to the new class", async () => {
    unwrap(await setTypeset(ctx, [{ name: "compact", size: 14, leading: 1.4 }]));
    unwrap(await setTypeset(ctx, [{ name: "compact", renameTo: "dense" }]));
    const typesets = (await diskTheme()).typography.typesets;
    expect(Object.keys(typesets ?? {})).toEqual(["dense"]);
    expect(typesets?.dense).toEqual({ size: 14, leading: 1.4 });
    const css = themeToCss(await diskTheme());
    expect(css).toContain(".typeset-dense {");
    expect(css).not.toContain(".typeset-compact {");
  });

  test("a rename can retune in the same call", async () => {
    unwrap(await setTypeset(ctx, [{ name: "compact", size: 14, leading: 1.4 }]));
    unwrap(await setTypeset(ctx, [{ name: "compact", renameTo: "dense", leading: 1.2 }]));
    expect((await diskTheme()).typography.typesets?.dense).toEqual({ size: 14, leading: 1.2 });
  });

  test("removing a preset drops its rule, leaving regions on the baseline", async () => {
    unwrap(await setTypeset(ctx, [{ name: "compact", size: 14 }]));
    unwrap(await setTypeset(ctx, [{ name: "compact", remove: true }]));
    expect(Object.keys((await diskTheme()).typography.typesets ?? {})).toEqual([]);
    // The baseline still renders — a removed preset falls back to it, it does
    // not leave the folder without a rhythm.
    const css = themeToCss(await diskTheme());
    expect(css).not.toContain(".typeset-compact");
    expect(css).toContain("--typeset-leading: 1.75");
  });

  test("the default typeset is the baseline, so it cannot be renamed or removed", async () => {
    for (const spec of [{ renameTo: "base" }, { remove: true }]) {
      const r = await setTypeset(ctx, [spec]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.kind === "InvalidThemePath") {
        expect(r.error.reason).toContain("baseline");
      } else {
        throw new Error("expected an InvalidThemePath error");
      }
    }
  });

  test("rejects renaming onto a name already in use", async () => {
    unwrap(
      await setTypeset(ctx, [
        { name: "compact", size: 14 },
        { name: "docs", leading: 1.9 },
      ]),
    );
    const r = await setTypeset(ctx, [{ name: "compact", renameTo: "docs" }]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "InvalidThemePath") {
      expect(r.error.reason).toContain("already exists");
    } else {
      throw new Error("expected an InvalidThemePath error");
    }
    // The rejected call left both presets exactly as they were.
    const typesets = (await diskTheme()).typography.typesets;
    expect(typesets?.compact).toEqual({ size: 14 });
    expect(typesets?.docs).toEqual({ leading: 1.9 });
  });

  test("rejects renaming or removing a typeset that does not exist", async () => {
    for (const spec of [
      { name: "ghost", renameTo: "spook" },
      { name: "ghost", remove: true },
    ]) {
      const r = await setTypeset(ctx, [spec]);
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.kind === "InvalidThemePath") {
        expect(r.error.reason).toContain("does not exist");
      } else {
        throw new Error("expected an InvalidThemePath error");
      }
    }
  });

  // What the canvas panel's authored/inherited distinction rests on: clearing a
  // control on a preset must remove it from the record, not pin it to whatever
  // the baseline happened to be at the time.
  test("clearing a preset control returns it to following the baseline", async () => {
    unwrap(await setTypeset(ctx, [{ leading: 1.75 }]));
    unwrap(await setTypeset(ctx, [{ name: "docs", size: 18, leading: 2 }]));
    unwrap(await setTypeset(ctx, [{ name: "docs", size: null }]));
    expect((await diskTheme()).typography.typesets?.docs).toEqual({ leading: 2 });

    unwrap(await setTypeset(ctx, [{ size: 20 }]));
    const css = themeToCss(await diskTheme());
    const block = css.slice(css.indexOf(".typeset-docs {"));
    expect(block.slice(0, block.indexOf("}"))).not.toContain("--typeset-size");
    expect(css).toContain("--typeset-size: 20px");
  });
});

describe("setTokens (bulk)", () => {
  test("applies every entry with one persist and one broadcast", async () => {
    const r = unwrap(
      await setTokens(ctx, [
        { path: "colors.background", value: "oklch(0.98 0 0)" },
        { path: "colors.foreground", value: "oklch(0.2 0 0)" },
        { path: "colors.primary.foreground", value: "oklch(0.99 0 0)" },
      ]),
    );
    expect(r.applied).toEqual([
      "colors.background",
      "colors.foreground",
      "colors.primary.foreground",
    ]);
    const onDisk = await diskTheme();
    expect(onDisk.colors.background).toBe("oklch(0.98 0 0)");
    expect(onDisk.colors.foreground).toBe("oklch(0.2 0 0)");
    // The whole batch broadcast exactly once, not per entry (one WatchEvent
    // + one additive activity event).
    expect(events.filter((e) => e.type !== "activity")).toEqual([{ type: "theme-changed" }]);
  });

  test("any bad entry fails the batch with a per-entry report and persists nothing", async () => {
    const before = await diskTheme();
    const r = await setTokens(ctx, [
      { path: "colors.background", value: "oklch(0.5 0 0)" },
      { path: "colors.primary.DEFAULT", value: "" },
      { path: "", value: "x" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "BulkTokensInvalid") {
      expect(r.error.applied).toEqual(["colors.background"]);
      expect(r.error.failed.map((f) => f.path)).toEqual(["colors.primary.DEFAULT", ""]);
      expect(r.error.failed[0]?.reason).toContain("colors.primary.DEFAULT");
    } else if (!r.ok) {
      throw new Error(`expected BulkTokensInvalid, got ${r.error.kind}`);
    }
    // All-or-nothing: the valid first entry did NOT land on disk, and no
    // theme-changed event fired.
    expect(await diskTheme()).toEqual(before);
    expect(events).toEqual([]);
  });

  test("a slot the schema doesn't define is refused, not silently dropped", async () => {
    // `ThemeSchema` is a closed object, and zod STRIPS unknown keys rather
    // than rejecting them — so a misspelled slot used to parse cleanly, vanish
    // from the parsed result, and still be reported as applied. The agent was
    // told the token landed while nothing changed anywhere.
    const before = await diskTheme();
    const r = await setTokens(ctx, [{ path: "colors.nope.DEFAULT", value: "#ff0000" }]);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "BulkTokensInvalid") {
      expect(r.error.applied).toEqual([]);
      expect(r.error.failed[0]?.path).toBe("colors.nope.DEFAULT");
      expect(r.error.failed[0]?.reason).toContain("palette.");
    } else if (!r.ok) {
      throw new Error(`expected BulkTokensInvalid, got ${r.error.kind}`);
    }
    expect(await diskTheme()).toEqual(before);
  });

  test("a prototype-chain segment is refused before it is walked", async () => {
    const r = await setTokens(ctx, [{ path: "palette.__proto__.polluted", value: "#ff0000" }]);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("the palette passthrough still takes any name", async () => {
    const r = await setTokens(ctx, [{ path: "palette.brand-ink", value: "#123456" }]);
    expect(r.ok).toBe(true);
    expect(((await diskTheme()) as { palette?: Record<string, unknown> }).palette).toMatchObject({
      "brand-ink": "#123456",
    });
  });
});

describe("withThemeLock", () => {
  test("two folders do not share a theme lock chain", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = withThemeLock({ root: "/tmp/velloo-theme-lock-a" }, () => gate);
    // Would deadlock (until the test timeout) if both folders chained on one lock.
    const other = await withThemeLock({ root: "/tmp/velloo-theme-lock-b" }, async () => "ran");
    expect(other).toBe("ran");
    release();
    await held;
  });
});

describe("derivePaletteFromColor", () => {
  test("violet seed produces a violet theme; primary becomes a violet OKLCH", async () => {
    const r = unwrap(await derivePaletteFromColor(ctx, "#7c3aed"));
    const primary = r.theme.colors.primary;
    expect(typeof primary).toBe("object");
    if (typeof primary === "object") {
      expect(primary.DEFAULT).toContain("oklch");
    }
    const onDisk = await diskTheme();
    expect(onDisk.colors.primary).toEqual(primary as never);
  });

  test("a named derive writes theme/<name>.json and never touches the default", async () => {
    const before = await diskTheme();
    const r = unwrap(await derivePaletteFromColor(ctx, "#7c3aed", "brand"));
    expect(r.theme.name).toBe("brand");

    const named = JSON.parse(await readFile(join(tmp, "theme/brand.json"), "utf8")) as Theme;
    expect(named.name).toBe("brand");
    expect(named.colors.primary).toEqual(r.theme.colors.primary as never);

    // The default theme — on disk and in memory — is untouched.
    expect(await diskTheme()).toEqual(before);
    expect(folder.theme.name).toBe("default");
    expect(folder.themes.get("brand")).toBeDefined();
  });
});

describe("named-theme clone-on-write", () => {
  test("setToken on a missing named theme creates it with its own name, not 'default'", async () => {
    unwrap(await setToken(ctx, "colors.background", "oklch(0.2 0 0)", "midnight"));
    const named = JSON.parse(await readFile(join(tmp, "theme/midnight.json"), "utf8")) as Theme;
    expect(named.name).toBe("midnight");
    expect(named.colors.background).toBe("oklch(0.2 0 0)");
    // Clone-on-write: the default is the base but stays unchanged.
    expect((await diskTheme()).colors.background).toBe("oklch(1 0 0)");
  });
});
