import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../design-folder.ts";
import { type MutationContext, updateFrames } from "../index.ts";

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream",
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

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

const provider = createShadcnProvider();
let root: string;
let folder: DesignFolder;
let ctx: MutationContext;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  root = join(tmpdir(), `velloo-update-frame-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(root, ".design"), { recursive: true });
  await mkdir(join(root, "theme"), { recursive: true });
  await mkdir(join(root, "boards"), { recursive: true });
  await writeJson(join(root, ".design/config.json"), sampleConfig);
  await writeJson(join(root, "theme/default.json"), sampleTheme);
  await writeJson(join(root, "boards/main.json"), {
    id: "main",
    name: "Main",
    frames: [{ id: "home", screen: "home", x: 0, y: 0, w: 1440, h: 900 }],
    groups: [],
  });
  folder = await loadDesignFolder(root);
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => {},
  };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("update_frame scheme", () => {
  test("sets and explicitly clears a frame scheme", async () => {
    const pinned = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: "dark" } }],
      }),
    );
    expect(pinned.frames[0]?.scheme).toBe("dark");
    expect(folder.boards.get("main")?.frames[0]?.scheme).toBe("dark");

    const cleared = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: null } }],
      }),
    );
    expect(cleared.frames[0]?.scheme).toBeUndefined();
    expect(folder.boards.get("main")?.frames[0]?.scheme).toBeUndefined();

    const persisted = JSON.parse(await readFile(join(root, "boards/main.json"), "utf8")) as {
      frames: Array<Record<string, unknown>>;
    };
    expect(persisted.frames[0]).not.toHaveProperty("scheme");
  });

  test("an omitted scheme leaves the existing pin unchanged", async () => {
    unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { scheme: "light" } }],
      }),
    );
    const updated = unwrap(
      await updateFrames(ctx, {
        boardId: "main",
        patches: [{ frameId: "home", patch: { x: 12 } }],
      }),
    );
    expect(updated.frames[0]?.scheme).toBe("light");
  });
});
