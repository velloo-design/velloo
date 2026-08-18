import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { ScreenSchema } from "@velloo/schema";
import { findDesignConfig } from "./design-config.ts";
import { fail } from "./fail.ts";

const DEFAULT_FOLDER = "velloo";

/** True when `dir` already holds a Velloo design (has `.design/config.json`). */
export async function hasDesignConfig(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, ".design", "config.json"), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the design folder for a command. An explicit arg wins; otherwise
 * default to `./velloo`, then the cwd, then walk up for a `.design/config.json`
 * (so the command works from inside the folder or the app root). Fails with
 * guidance when nothing is found.
 */
export async function resolveDesignFolder(arg: string | undefined, cmd: string): Promise<string> {
  if (arg) return resolve(arg);
  const here = resolve(DEFAULT_FOLDER);
  if (await hasDesignConfig(here)) return here;
  if (await hasDesignConfig(resolve("."))) return resolve(".");
  const found = await findDesignConfig(resolve("."));
  if (found) return found.folder;
  fail(
    cmd,
    `no design folder found. Pass one (e.g. \`velloo ${cmd} ./velloo\`), run from a folder that contains a Velloo design, or \`velloo init\` first.`,
  );
}

export interface ScreenEntry {
  id: string;
  name: string;
  path: string;
}

/** Every screen under `<folder>/screens`, sorted; skips unparseable files. */
export async function listScreens(folder: string): Promise<ScreenEntry[]> {
  let files: string[];
  try {
    files = (await readdir(join(folder, "screens"))).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ScreenEntry[] = [];
  for (const f of files.sort()) {
    const path = join(folder, "screens", f);
    try {
      const s = ScreenSchema.parse(JSON.parse(await readFile(path, "utf8")));
      out.push({ id: s.id, name: s.name || s.id, path });
    } catch {
      // skip a malformed/partial screen rather than abort the whole picker
    }
  }
  return out;
}

/**
 * Resolve a screen for a command: an explicit id/path arg, else (interactive) a
 * picker over the folder's screens, else fail. With exactly one screen the
 * picker is skipped.
 */
export async function pickScreen(
  folder: string,
  arg: string | undefined,
  interactive: boolean,
  cmd: string,
): Promise<ScreenEntry> {
  const screens = await listScreens(folder);
  if (arg) {
    const byId = screens.find((s) => s.id === arg);
    if (byId) return byId;
    // Treat the arg as a path (back-compat with the old `screen` positional).
    return { id: arg, name: arg, path: resolve(arg) };
  }
  if (screens.length === 0) fail(cmd, `no screens found in ${folder}/screens.`);
  if (screens.length === 1) return screens[0] as ScreenEntry;
  if (!interactive) {
    fail(cmd, `pick a screen: ${screens.map((s) => s.id).join(", ")}`);
  }
  const chosen = await select<string>({
    message: "Which screen?",
    options: screens.map((s) => ({ value: s.id, label: s.name, hint: `${s.id}.json` })),
  });
  if (isCancel(chosen)) fail(cmd, "cancelled.");
  return screens.find((s) => s.id === chosen) as ScreenEntry;
}
