import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { type MutationContext, updateFeedback } from "../mutations/index.ts";
import { readRepoFeedback } from "../repo-config.ts";

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

let repo: string;
let folder: string;

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function scaffold(configPatch: Record<string, unknown> = {}) {
  await mkdir(join(folder, ".design"), { recursive: true });
  await mkdir(join(folder, "theme"), { recursive: true });
  await mkdir(join(folder, "boards"), { recursive: true });
  await mkdir(join(folder, "screens"), { recursive: true });
  await writeJson(join(folder, ".design/config.json"), {
    schemaVersion: 3,
    toolVersion: "0.1.0",
    libraries: {
      default: { id: "shadcn-upstream", version: "t", source: "binary", componentsPath: "binary" },
    },
    defaultLibrary: "default",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    ...configPatch,
  });
  await writeJson(join(folder, "theme/default.json"), sampleTheme);
}

async function context(): Promise<{ ctx: MutationContext; design: DesignFolder }> {
  const design = await loadDesignFolder(folder);
  return {
    design,
    ctx: {
      folder: design,
      providers: { default: provider },
      defaultProvider: provider,
      broadcast: () => {},
    },
  };
}

beforeEach(async () => {
  repo = join(tmpdir(), `velloo-repo-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  folder = join(repo, "velloo");
  await mkdir(repo, { recursive: true });
  // Contact consent is machine-level — point it at the tmp repo so the suite
  // never reads or writes the developer's real ~/.velloo/prefs.json.
  process.env.VELLOO_PREFS_PATH = join(repo, "prefs.json");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  process.env.VELLOO_PREFS_PATH = undefined;
});

describe("feedback consent lives at the repo root", () => {
  test("a folder in a repo reads the repo's answer, not its own config", async () => {
    await scaffold();
    await writeJson(join(repo, "velloo.json"), {
      projects: { app: "velloo" },
      feedback: { enabled: true },
    });
    const { design } = await context();
    expect(design.config.feedback).toEqual({ enabled: true, contactOk: false });
  });

  test("a contactOk committed by someone else is ignored, not inherited", async () => {
    // The whole point of the split: cloning a repo must not opt this person
    // into being contacted.
    await scaffold({ feedback: { enabled: true, contactOk: true } });
    await writeJson(join(repo, "velloo.json"), {
      projects: { app: "velloo" },
      feedback: { enabled: true, contactOk: true },
    });
    const { design } = await context();
    expect(design.config.feedback).toEqual({ enabled: true, contactOk: false });
  });

  test("contactOk comes from this machine and never lands in a committed file", async () => {
    await scaffold();
    await writeJson(join(repo, "velloo.json"), { projects: { app: "velloo" } });
    const { ctx } = await context();
    unwrap(await updateFeedback(ctx, { enabled: true, contactOk: true }));

    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.feedback).toEqual({ enabled: true });
    const prefs = JSON.parse(await readFile(join(repo, "prefs.json"), "utf8"));
    expect(prefs.feedbackContactOk).toBe(true);
    // A fresh load picks it back up.
    expect((await loadDesignFolder(folder)).config.feedback).toEqual({
      enabled: true,
      contactOk: true,
    });
  });

  test("the repo answer wins over a stale folder-level one", async () => {
    await scaffold({ feedback: { enabled: true, contactOk: true } });
    await writeJson(join(repo, "velloo.json"), {
      projects: { app: "velloo" },
      feedback: { enabled: false },
    });
    const { design } = await context();
    expect(design.config.feedback).toEqual({ enabled: false, contactOk: false });
  });

  test("a folder written before the move keeps its own answer", async () => {
    await scaffold({ feedback: { enabled: true, contactOk: false } });
    await writeJson(join(repo, "velloo.json"), { projects: { app: "velloo" } });
    const { design } = await context();
    expect(design.config.feedback).toEqual({ enabled: true, contactOk: false });
  });

  test("update_feedback writes velloo.json and leaves the folder config alone", async () => {
    await scaffold();
    await writeJson(join(repo, "velloo.json"), { projects: { app: "velloo" } });
    const { ctx } = await context();
    const result = unwrap(await updateFeedback(ctx, { enabled: true, contactOk: true }));
    expect(result).toEqual({ enabled: true, contactOk: true });

    const manifest = JSON.parse(await readFile(join(repo, "velloo.json"), "utf8"));
    expect(manifest.feedback).toEqual({ enabled: true });
    // The projects map survives the write.
    expect(manifest.projects).toEqual({ app: "velloo" });
    const config = JSON.parse(await readFile(join(folder, ".design/config.json"), "utf8"));
    expect(config.feedback).toBeUndefined();
    // Every reader goes through folder.config, so the in-memory copy moves too.
    expect(ctx.folder.config.feedback).toEqual({ enabled: true, contactOk: true });
  });

  test("both design folders in a repo see one answer", async () => {
    await scaffold();
    const second = join(repo, "brand");
    const first = folder;
    folder = second;
    await scaffold();
    folder = first;
    await writeJson(join(repo, "velloo.json"), { projects: { app: "velloo", brand: "brand" } });

    const { ctx } = await context();
    unwrap(await updateFeedback(ctx, { enabled: true, contactOk: false }));
    expect((await loadDesignFolder(second)).config.feedback).toEqual({
      enabled: true,
      contactOk: false,
    });
  });

  test("contactOk survives switching the tool off and on", async () => {
    await scaffold();
    await writeJson(join(repo, "velloo.json"), { projects: { app: "velloo" } });
    const { ctx } = await context();
    unwrap(await updateFeedback(ctx, { enabled: true, contactOk: true }));
    unwrap(await updateFeedback(ctx, { enabled: false }));
    expect(await readRepoFeedback(folder)).toEqual({ enabled: false });
    expect((await loadDesignFolder(folder)).config.feedback?.contactOk).toBe(true);
  });

  test("a folder outside any repo keeps the answer in its own config", async () => {
    await scaffold();
    const { ctx } = await context();
    unwrap(await updateFeedback(ctx, { enabled: true, contactOk: false }));
    const config = JSON.parse(await readFile(join(folder, ".design/config.json"), "utf8"));
    expect(config.feedback).toEqual({ enabled: true });
  });

  test("a malformed velloo.json doesn't stop the folder from loading", async () => {
    await scaffold({ feedback: { enabled: true } });
    await writeFile(join(repo, "velloo.json"), "{ not json", "utf8");
    const { design } = await context();
    expect(design.config.feedback?.enabled).toBe(true);
  });
});
