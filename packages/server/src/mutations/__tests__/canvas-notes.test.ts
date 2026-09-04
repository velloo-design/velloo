import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { createNotesRouter } from "../../routes/markup.ts";
import type { WatchEvent } from "../../watcher.ts";
import { addNote, type MutationContext, updateNote } from "../index.ts";

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: { id: "shadcn-upstream", version: "test", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const provider = createShadcnProvider();

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const screenTree = {
  $ref: "Box",
  children: [{ $ref: "Button", $id: "cta", props: { children: "Go" } }],
};

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-notes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/home.json"), { id: "home", name: "Home", tree: screenTree });
  await writeJson(join(tmp, "screens/about.json"), {
    id: "about",
    name: "About",
    tree: screenTree,
  });
  await writeJson(join(tmp, "boards/main.json"), {
    id: "main",
    name: "Main",
    frames: [
      { id: "fr_home", screen: "home", x: 0, y: 0, w: 1440, h: 900 },
      { id: "fr_about", screen: "about", x: 1600, y: 0, w: 1440, h: 900 },
    ],
    groups: [],
  });
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const anchor = { frameId: "fr_home", screenId: "home", locator: "@cta" as const };

describe("add_note", () => {
  test("a free note keeps its board coordinates and carries no anchor", async () => {
    const { note } = unwrap(await addNote(ctx, { boardId: "main", x: 40, y: 80, body: "beside" }));
    expect(note.x).toBe(40);
    expect(note.y).toBe(80);
    expect(note.attachment).toBeUndefined();
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.notes.get("main")?.[0]?.body).toBe("beside");
  });

  test("a free note without coordinates is refused", async () => {
    const result = await addNote(ctx, { boardId: "main", body: "nowhere" });
    expect(result.ok).toBe(false);
  });

  test("an attached note persists its anchor and is left unplaced for the canvas", async () => {
    const { note } = unwrap(
      await addNote(ctx, { boardId: "main", body: "tighten this", attachment: anchor }),
    );
    expect(note.attachment).toEqual(anchor);
    expect(note.x).toBeUndefined();
    expect(note.y).toBeUndefined();
    const reloaded = await loadDesignFolder(tmp);
    expect(reloaded.notes.get("main")?.[0]?.attachment).toEqual(anchor);
  });

  test("refuses an anchor on a frame that is not on this board", async () => {
    const result = await addNote(ctx, {
      boardId: "main",
      body: "x",
      attachment: { ...anchor, frameId: "fr_missing" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("FrameNotFound");
  });

  test("refuses an anchor whose frame shows a different screen", async () => {
    const result = await addNote(ctx, {
      boardId: "main",
      body: "x",
      attachment: { ...anchor, screenId: "about" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("InvalidPath");
  });

  test("refuses an anchor whose node does not exist on the screen", async () => {
    const result = await addNote(ctx, {
      boardId: "main",
      body: "x",
      attachment: { ...anchor, locator: "@nope" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("IdNotFound");
  });
});

describe("update_note", () => {
  test("dragging an attached note pins coordinates without dropping the anchor", async () => {
    const { note } = unwrap(await addNote(ctx, { boardId: "main", body: "x", attachment: anchor }));
    const { note: moved } = unwrap(
      await updateNote(ctx, { boardId: "main", noteId: note.id, patch: { x: 300, y: 120 } }),
    );
    expect(moved.x).toBe(300);
    expect(moved.attachment).toEqual(anchor);
  });
});

describe("GET /api/notes/:boardId", () => {
  const list = async () => {
    const router = createNotesRouter(() => ctx);
    const res = await router.request("/main");
    return (await res.json()) as {
      notes: { id: string; resolved?: number[] | null }[];
    };
  };

  test("resolves an anchor to the node's current path", async () => {
    await addNote(ctx, { boardId: "main", body: "x", attachment: anchor });
    const { notes } = await list();
    expect(notes[0]?.resolved).toEqual([0]);
  });

  test("reports a vanished node as unresolved rather than dropping the note", async () => {
    await addNote(ctx, { boardId: "main", body: "x", attachment: anchor });
    await writeJson(join(tmp, "screens/home.json"), {
      id: "home",
      name: "Home",
      tree: { $ref: "Box", children: [] },
    });
    folder = await loadDesignFolder(tmp);
    ctx = { ...ctx, folder };
    const { notes } = await list();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.resolved).toBeNull();
  });

  test("a free note carries no resolved path at all", async () => {
    await addNote(ctx, { boardId: "main", x: 10, y: 10, body: "x" });
    const { notes } = await list();
    expect(notes[0]).not.toHaveProperty("resolved");
  });
});
