import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Theme, ThemeSchema } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../activity.ts";
import { createApp } from "../app.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { designConfig, designTheme } from "../testing/design-folder.ts";

import type { WatchEvent } from "../watcher.ts";

/**
 * The canvas typography panel drives typesets over HTTP, so the route has to
 * accept the same spec shape the MCP tool does — including the nulls that clear
 * a control back to inherited, and the rename/remove a preset list needs.
 */

const provider = createShadcnProvider();

const sampleConfig = designConfig();

const sampleTheme = designTheme();

let tmp: string;
let folder: DesignFolder;
let events: (WatchEvent | ActivityEvent)[];
let app: ReturnType<typeof createApp>;

async function diskTheme(): Promise<Theme> {
  return JSON.parse(await readFile(join(tmp, "theme/default.json"), "utf8")) as Theme;
}

async function post(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/theme/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function setTypeset(typesets: unknown[]): Promise<Response> {
  return post("set_typeset", { typesets });
}

async function setFonts(fonts: unknown[]): Promise<Response> {
  return post("set_fonts", { fonts });
}

async function reason(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { reason?: string } };
  return body.error?.reason ?? "";
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-theme-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeFile(join(tmp, ".design/config.json"), JSON.stringify(sampleConfig));
  await writeFile(join(tmp, "theme/default.json"), JSON.stringify(sampleTheme));
  folder = await loadDesignFolder(tmp);
  events = [];
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
  const jit = new TailwindJit(provider, join(folder.root, "screens"));
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    () => undefined,
  );
  app = createApp(() => ctx, jit, bundler, canvasBundler);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

test("set_typeset persists the controls and broadcasts theme-changed", async () => {
  const res = await setTypeset([{ leading: 1.4, flow: "1em" }]);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { theme: Theme };
  expect(body.theme.typography.typesets?.default).toEqual({ leading: 1.4, flow: "1em" });
  expect((await diskTheme()).typography.typesets?.default).toEqual({ leading: 1.4, flow: "1em" });
  expect(events.some((e) => e.type === "theme-changed")).toBe(true);
});

test("null clears a control, which is how the panel returns one to inherited", async () => {
  await setTypeset([{ name: "docs", size: 18, leading: 2 }]);
  const res = await setTypeset([{ name: "docs", size: null }]);
  expect(res.status).toBe(200);
  expect((await diskTheme()).typography.typesets?.docs).toEqual({ leading: 2 });
});

test("presets can be added, renamed and removed over the same route", async () => {
  // A new preset authors nothing — it inherits every control until one moves.
  expect((await setTypeset([{ name: "docs" }])).status).toBe(200);
  expect((await diskTheme()).typography.typesets?.docs).toEqual({});

  expect((await setTypeset([{ name: "docs", renameTo: "guide" }])).status).toBe(200);
  expect(Object.keys((await diskTheme()).typography.typesets ?? {})).toEqual(["guide"]);

  expect((await setTypeset([{ name: "guide", remove: true }])).status).toBe(200);
  expect(Object.keys((await diskTheme()).typography.typesets ?? {})).toEqual([]);
});

test("a rejected spec answers with the typed error envelope, not a 500", async () => {
  const res = await setTypeset([{ name: "bad name", size: 14 }]);
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error?: { kind?: string; reason?: string } };
  expect(body.error?.kind).toBe("InvalidThemePath");
  expect(body.error?.reason).toContain("selector-safe");
});

test("set_fonts declares a role and queues the webfont the picker chose", async () => {
  const res = await setFonts([
    {
      role: "display",
      family: "Fraunces",
      fallback: "ui-serif, Georgia, serif",
      google: "wght@300..700",
    },
  ]);
  expect(res.status).toBe(200);
  const typography = (await diskTheme()).typography;
  expect(typography.fontFamily?.display).toBe('"Fraunces", ui-serif, Georgia, serif');
  expect(typography.googleFonts).toEqual(["Fraunces:wght@300..700"]);
  expect(events.some((e) => e.type === "theme-changed")).toBe(true);
});

// Browsing means reassigning a role over and over. Without the prune, every
// family tried on stays in googleFonts and keeps being fetched forever.
test("reassigning a role drops the webfont nothing renders any more", async () => {
  await setFonts([{ role: "display", family: "Fraunces", google: "wght@300..700" }]);
  await setFonts([{ role: "display", family: "Syne", google: "wght@400..800" }]);
  expect((await diskTheme()).typography.googleFonts).toEqual(["Syne:wght@400..800"]);
});

test("a family kept on another role survives the prune", async () => {
  await setFonts([
    { role: "display", family: "Syne", google: "wght@400..800" },
    { role: "sans", family: "Inter", google: "wght@400..700" },
  ]);
  await setFonts([{ role: "display", family: "Anton", google: true }]);
  const googleFonts = (await diskTheme()).typography.googleFonts ?? [];
  expect(googleFonts.sort()).toEqual(["Anton", "Inter:wght@400..700"]);
});

test("removing a role drops it and its webfont", async () => {
  await setFonts([{ role: "display", family: "Syne", google: "wght@400..800" }]);
  expect((await setFonts([{ role: "display", remove: true }])).status).toBe(200);
  const typography = (await diskTheme()).typography;
  expect(typography.fontFamily?.display).toBeUndefined();
  expect(typography.googleFonts).toEqual([]);
});

// A typeset naming a role that no longer exists resolves to an undefined var,
// which fails silently — so the removal has to be refused instead.
test("a role a typeset still names cannot be removed", async () => {
  await setFonts([{ role: "display", family: "Syne", google: "wght@400..800" }]);
  await setTypeset([{ name: "docs", fontHeading: "display" }]);

  const res = await setFonts([{ role: "display", remove: true }]);
  expect(res.status).toBe(400);
  expect(await reason(res)).toContain("docs");
  expect((await diskTheme()).typography.fontFamily?.display).toBeDefined();

  // Point the face elsewhere and the removal goes through.
  await setTypeset([{ name: "docs", fontHeading: null }]);
  expect((await setFonts([{ role: "display", remove: true }])).status).toBe(200);
});

test("removing a role that was never declared is refused", async () => {
  const res = await setFonts([{ role: "ghost", remove: true }]);
  expect(res.status).toBe(400);
  expect(await reason(res)).toContain("does not exist");
});

test("a role name that is not utility-safe is refused", async () => {
  const res = await setFonts([{ role: "Display Face", family: "Syne" }]);
  expect(res.status).toBe(400);
  expect(await reason(res)).toContain("utility-name safe");
});

/**
 * A board can pin its own theme, and the panel edits whatever the board on
 * screen renders with. Without a name on the read and the write, the panel
 * showed default.json while the frames rendered the pinned theme — so every
 * drag landed in a file nothing on screen used and appeared to do nothing.
 */
test("reads and writes address the named theme a board pins", async () => {
  const ember = ThemeSchema.parse({ ...sampleTheme, name: "ember" });
  await writeFile(join(tmp, "theme/ember.json"), JSON.stringify(ember));
  folder.themes.set("ember", ember);

  const read = await app.fetch(new Request("http://localhost/api/theme?name=ember"));
  expect(((await read.json()) as Theme).name).toBe("ember");

  expect((await post("set_typeset", { typesets: [{ size: 17 }], theme: "ember" })).status).toBe(
    200,
  );
  const written = JSON.parse(await readFile(join(tmp, "theme/ember.json"), "utf8")) as Theme;
  expect(written.typography.typesets?.default).toEqual({ size: 17 });
  expect((await diskTheme()).typography.typesets).toBeUndefined();
});

test("add_theme clones the theme it is given, leaving the source alone", async () => {
  await post("set_token", { path: "colors.background", value: "oklch(0.2 0 0)" });

  const res = await post("add_theme", { name: "variant", from: "default" });
  expect(res.status).toBe(200);

  const clone = JSON.parse(await readFile(join(tmp, "theme/variant.json"), "utf8")) as Theme;
  expect(clone.colors.background).toBe("oklch(0.2 0 0)");
  // The stem is the identity, so the clone answers to its own file name rather
  // than inheriting the source's — writes address it by that name.
  expect(clone.name).toBe("variant");

  await post("set_token", { path: "colors.background", value: "oklch(0.5 0 0)", theme: "variant" });
  expect((await diskTheme()).colors.background).toBe("oklch(0.2 0 0)");
});

test("colours and presets are theme-scoped too, not just typography", async () => {
  const ember = ThemeSchema.parse({ ...sampleTheme, name: "ember" });
  await writeFile(join(tmp, "theme/ember.json"), JSON.stringify(ember));
  folder.themes.set("ember", ember);

  await post("set_token", { path: "colors.background", value: "oklch(0.2 0 0)", theme: "ember" });
  const tokened = JSON.parse(await readFile(join(tmp, "theme/ember.json"), "utf8")) as Theme;
  expect(tokened.colors.background).toBe("oklch(0.2 0 0)");
  expect((await diskTheme()).colors.background).toBe("oklch(1 0 0)");

  await post("apply_preset", { presetName: "violet", theme: "ember" });
  const preset = JSON.parse(await readFile(join(tmp, "theme/ember.json"), "utf8")) as Theme;
  // The file's own name always matches its stem, whichever preset filled it.
  expect(preset.name).toBe("ember");
  expect((await diskTheme()).colors.background).toBe("oklch(1 0 0)");
});

/**
 * Every typeset edit merges onto whatever `themeByName` returns, so undo has to
 * repair the in-memory theme map and not just the `folder.theme` pointer. When
 * it didn't, the next single-control edit re-persisted the whole pre-undo
 * typeset — dragging leading silently put size and flow back.
 */
test("after an undo, touching one control leaves the others reverted", async () => {
  await setTypeset([{ size: 18 }]);
  await setTypeset([{ leading: 1.9 }]);
  await setTypeset([{ flow: "2em" }]);
  expect((await diskTheme()).typography.typesets?.default).toEqual({
    size: 18,
    leading: 1.9,
    flow: "2em",
  });

  await app.fetch(new Request("http://localhost/api/undo", { method: "POST" }));
  expect((await diskTheme()).typography.typesets?.default).toEqual({ size: 18, leading: 1.9 });

  await setTypeset([{ leading: 1.2 }]);
  expect((await diskTheme()).typography.typesets?.default).toEqual({ size: 18, leading: 1.2 });
});

test("undo restores the named theme the edit was made against", async () => {
  const ember = ThemeSchema.parse({
    ...sampleTheme,
    name: "ember",
    typography: { typesets: { default: {} } },
  });
  await writeFile(join(tmp, "theme/ember.json"), JSON.stringify(ember));
  folder.themes.set("ember", ember);

  await post("set_typeset", { typesets: [{ size: 21 }], theme: "ember" });
  const written = JSON.parse(await readFile(join(tmp, "theme/ember.json"), "utf8")) as Theme;
  expect(written.typography.typesets?.default).toEqual({ size: 21 });

  await app.fetch(new Request("http://localhost/api/undo", { method: "POST" }));
  const reverted = JSON.parse(await readFile(join(tmp, "theme/ember.json"), "utf8")) as Theme;
  expect(reverted.typography.typesets?.default).toEqual({});
  // The default theme is untouched — an undo of a named-theme edit must not
  // splice that theme's snapshot into default.json.
  expect((await diskTheme()).name).toBe("default");
  expect((await diskTheme()).typography.typesets).toBeUndefined();
});
