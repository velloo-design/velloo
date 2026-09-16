import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm, isCancel, log, select } from "@clack/prompts";
import { CHROMIUM_INSTALL_CMD, chromiumExecutable } from "@velloo/renderer";
import {
  type Board,
  CURRENT_SCHEMA_VERSION,
  planMigration,
  type Screen,
  schemaVersionOf,
  type Theme,
} from "@velloo/schema";
import pc from "picocolors";
import {
  applyAppRootChange,
  planAppRootChange,
  promptAppRootChoice,
  recordedAppRoot,
} from "./app-root.ts";
import { installChromiumInteractive } from "./browser-setup.ts";
import { globallyWiredAgents } from "./connect/index.ts";
import { daemonRoot, ensureDaemon, stopDaemon } from "./daemon/runtime.ts";
import { findDesigns, registerDesign } from "./manifest.ts";
import { findMuiTheme, importThemeFromMui } from "./scaffold/import-mui-theme.ts";
import { importThemeFromGlobals } from "./scaffold/import-theme.ts";
import { detectHost } from "./scan/detect.ts";
import { buildBoardsFromScan, buildScreensFromScan, scanApps } from "./scan/index.ts";
import { upgradeFolder } from "./upgrade-folder.ts";
import { TOOL_VERSION } from "./version.ts";
import type { LibraryId } from "./wizard/answers.ts";
import { WIZARD_PROVIDERS } from "./wizard/provider-registry.ts";

/**
 * `velloo init` in a repo that already has a design folder isn't a scaffold —
 * it's the maintenance menu for that folder. Each action here is something a
 * user genuinely re-runs: wire a new agent, pick up routes the app grew, pull
 * the app's theme again after a redesign, or add a second design folder.
 *
 * Deliberately absent: "re-scaffold (overwrite)". It never replaced a design —
 * it wrote a fresh config + sample over the existing files and left every
 * board and screen whose id wasn't in the sample, producing a hybrid folder
 * and losing config (viewport presets, hostApp, feedback). Deleting the folder
 * and re-running init is both cleaner and obvious; `--force` still exists for
 * automation.
 */
export type ExistingAction =
  | "another"
  | "connect"
  | "scan"
  | "theme"
  | "check"
  | "open"
  | "upgrade"
  | "cancel";

export interface FolderFacts {
  /** Absolute path to the design folder. */
  folder: string;
  library: string;
  schemaVersion: number;
  /** Human summaries of the migrations a `velloo upgrade` would apply. */
  pendingMigrations: string[];
  /** Recorded toolVersion differs from this binary — agent artifacts may be stale. */
  toolVersionStale: boolean;
  /** The design's name, when the checkout lists it. */
  design: string | undefined;
}

async function readConfig(folder: string): Promise<Record<string, unknown>> {
  const raw: unknown = JSON.parse(await readFile(join(folder, ".design", "config.json"), "utf8"));
  return (raw ?? {}) as Record<string, unknown>;
}

/** What the menu needs to know about the folder it's about to act on. */
export async function readFolderFacts(folder: string, appRoot: string): Promise<FolderFacts> {
  const config = await readConfig(folder);
  const libraries = (config.libraries ?? {}) as Record<string, { id?: string | undefined }>;
  const defaultLibrary = typeof config.defaultLibrary === "string" ? config.defaultLibrary : "";
  const library = libraries[defaultLibrary]?.id ?? Object.values(libraries)[0]?.id ?? "unknown";
  let design: string | undefined;
  try {
    const designs = await findDesigns(appRoot);
    design = designs?.designs.find((d) => resolve(d.root) === resolve(folder))?.name;
  } catch {
    // A broken manifest is the `check setup` action's problem, not the menu's.
  }
  return {
    folder,
    library,
    schemaVersion: schemaVersionOf(config),
    pendingMigrations: planMigration(config).applied,
    toolVersionStale: config.toolVersion !== TOOL_VERSION,
    design,
  };
}

/**
 * A path the reader can place: the repo-relative one when it's actually
 * shorter, else the absolute. `relative()` alone produces `../../../../tmp/…`
 * when the cwd is nowhere near the folder.
 */
function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && rel.length < path.length && !rel.startsWith("../..") ? rel : path;
}

/**
 * What a *second* design folder in the same repo should inherit from the
 * first: the app hasn't changed between them, so re-asking which component
 * library it uses (and where its components live) invites two folders that
 * disagree about the same app.
 */
export async function inheritedFromFolder(
  folder: string,
): Promise<{ library: string | undefined; componentsDir: string | undefined }> {
  try {
    const config = await readConfig(folder);
    const libraries = (config.libraries ?? {}) as Record<string, { id?: string | undefined }>;
    const defaultLibrary = typeof config.defaultLibrary === "string" ? config.defaultLibrary : "";
    const codegen = (config.codegen ?? {}) as { componentsDir?: string | undefined };
    return {
      library: libraries[defaultLibrary]?.id ?? Object.values(libraries)[0]?.id,
      componentsDir: codegen.componentsDir,
    };
  } catch {
    return { library: undefined, componentsDir: undefined };
  }
}

/** One dim line under the prompt: what init found, so the menu has context. */
export function factsLine(facts: FolderFacts, folder: string): string {
  const parts = [
    `${displayPath(folder)}/`,
    facts.library,
    facts.pendingMigrations.length > 0
      ? `format v${facts.schemaVersion} → v${CURRENT_SCHEMA_VERSION}`
      : `format v${facts.schemaVersion} (current)`,
  ];
  if (facts.design) parts.push(`design "${facts.design}"`);
  return parts.join(" · ");
}

export async function promptExistingFolderAction(
  facts: FolderFacts,
  folder: string,
): Promise<ExistingAction | null> {
  const options: { value: ExistingAction; label: string; hint?: string }[] = [];
  // A pending migration is the one thing that blocks the daemon, so it leads.
  if (facts.pendingMigrations.length > 0) {
    options.push({
      value: "upgrade",
      label: "Upgrade folder format",
      hint: `v${facts.schemaVersion} → v${CURRENT_SCHEMA_VERSION}`,
    });
  }
  options.push(
    {
      value: "another",
      label: "Create another design folder",
      hint: "a second canvas in this repo",
    },
    { value: "connect", label: "Connect agents", hint: "wire the MCP into Claude Code / Cursor" },
    {
      value: "scan",
      label: "Scan for new routes",
      hint: "add screens for routes you've since added",
    },
    { value: "theme", label: "Re-import theme from the app", hint: "pull the app's tokens again" },
    { value: "check", label: "Check setup", hint: "browser, agent wiring, velloo.json, host app" },
    { value: "open", label: "Open the canvas", hint: "velloo run" },
    { value: "cancel", label: "Cancel" },
  );
  log.info(pc.dim(factsLine(facts, folder)));
  const action = await select<ExistingAction>({
    message: "Velloo is already set up here. What would you like to do?",
    options,
    initialValue: options[0]?.value ?? "cancel",
  });
  if (isCancel(action)) return null;
  return action;
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Migrate the folder on disk, delegating to the same code as `velloo upgrade`. */
export async function runUpgrade(folder: string): Promise<void> {
  const result = await upgradeFolder(folder);
  if (result.applied.length === 0) {
    console.log(pc.dim("  Already on the current format — nothing to do."));
    return;
  }
  console.log(`velloo: upgraded ${displayPath(folder)} (v${result.from} → v${result.to})`);
  for (const step of result.applied) console.log(pc.dim(`  ${step}`));
  console.log(pc.dim(`  Refresh agent skills too with \`velloo upgrade ${displayPath(folder)}\`.`));
}

/**
 * Add screens for routes the app has grown since the folder was scaffolded.
 * Additive only: existing screens are never touched, and routes that already
 * have a screen are skipped, so re-running is safe.
 */
export async function runScan(folder: string, appRoot: string, scanDir?: string): Promise<void> {
  const scanned = await scanApps(appRoot, scanDir);
  if (scanned.routes.length === 0) {
    log.warn("No routes found — nothing to add.");
    return;
  }
  let existing: string[] = [];
  try {
    existing = (await readdir(join(folder, "screens")))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".annotations.json"))
      .map((f) => f.slice(0, -".json".length));
  } catch {
    // No screens/ yet — every route is new.
  }
  const seen = new Set(existing);
  const fresh = scanned.routes.filter((r) => !seen.has(r.id));
  if (fresh.length === 0) {
    log.success(`All ${scanned.routes.length} routes already have screens — nothing to add.`);
    return;
  }
  log.info(
    `${fresh.length} new route${fresh.length === 1 ? "" : "s"}: ${fresh
      .slice(0, 8)
      .map((r) => r.routePath)
      .join(", ")}${fresh.length > 8 ? ", …" : ""}`,
  );
  const go = await confirm({
    message: `Add ${fresh.length} placeholder screen(s) on a new board?`,
  });
  if (isCancel(go) || !go) {
    console.log(pc.dim("  Nothing changed."));
    return;
  }

  const config = await readConfig(folder);
  const libraries = (config.libraries ?? {}) as Record<string, { id?: string | undefined }>;
  const libraryId = (Object.values(libraries)[0]?.id ?? "shadcn-upstream") as LibraryId;
  const scanOpts = WIZARD_PROVIDERS[libraryId]?.scanScreenOpts ?? { hasBadge: true };
  const screens: Screen[] = buildScreensFromScan({ routes: fresh, ...scanOpts });
  const boards: Board[] = buildBoardsFromScan({ routes: fresh });

  await mkdir(join(folder, "screens"), { recursive: true });
  await mkdir(join(folder, "boards"), { recursive: true });
  for (const screen of screens) {
    await writeJson(join(folder, "screens", `${screen.id}.json`), screen);
  }
  // Land the new frames on their own board rather than reshuffling an
  // existing one — the user decides where they belong from the canvas.
  const stamp = new Date().toISOString().slice(0, 10);
  const existingBoards = new Set(
    (await readdir(join(folder, "boards")).catch(() => []))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".notes.json"))
      .map((f) => f.slice(0, -".json".length)),
  );
  for (const board of boards) {
    let id = `${board.id}-${stamp}`;
    let attempt = 2;
    while (existingBoards.has(id)) id = `${board.id}-${stamp}-${attempt++}`;
    existingBoards.add(id);
    await writeJson(join(folder, "boards", `${id}.json`), {
      ...board,
      id,
      name: `${board.name} — new routes ${stamp}`,
    });
  }
  log.success(
    `Added ${screens.length} screen${screens.length === 1 ? "" : "s"} on ${boards.length} board${boards.length === 1 ? "" : "s"}.`,
  );
}

/**
 * Pull the host app's theme again — for when the app's design language moved
 * after the folder was created. Overwrites `theme/default.json`, so it asks
 * first and says what it found.
 */
export async function runThemeReimport(folder: string, appRoot: string): Promise<void> {
  const scanned = await scanApps(appRoot);
  const scanRoot = scanned.apps[0]?.dir ?? appRoot;
  const detected = detectHost(scanRoot);
  let imported: { theme: Theme; importedFrom: string; tokenCount: number } | null = null;
  if (detected.uiLibrary === "mui") {
    const themeFile = findMuiTheme(scanRoot);
    if (themeFile) imported = importThemeFromMui(themeFile);
  }
  if (!imported && detected.globalsCssPath) {
    imported = importThemeFromGlobals(detected.globalsCssPath);
  }
  if (!imported) {
    log.warn(
      "Couldn't find a theme to import — no globals.css tokens and no MUI createTheme() in the app.",
    );
    return;
  }
  const from = displayPath(imported.importedFrom);
  log.info(`Found ${imported.tokenCount} color token(s) in ${from}.`);
  const go = await confirm({
    message: "Replace theme/default.json with the app's tokens? Custom edits to it are lost.",
    initialValue: false,
  });
  if (isCancel(go) || !go) {
    console.log(pc.dim("  Nothing changed."));
    return;
  }
  await writeJson(join(folder, "theme", "default.json"), imported.theme);
  log.success(`Theme re-imported from ${from}.`);
}

/**
 * The things that quietly rot: a stale format, an unregistered folder, a
 * missing browser, a host-app path that moved. Reports all of them, then
 * offers to fix the two that are one command away.
 */
export async function runCheckSetup(folder: string, appRoot: string): Promise<void> {
  const facts = await readFolderFacts(folder, appRoot);
  const config = await readConfig(folder);
  const ok = (s: string) => console.log(`  ${pc.green("✓")} ${s}`);
  const bad = (s: string) => console.log(`  ${pc.yellow("!")} ${s}`);

  if (facts.pendingMigrations.length > 0) {
    bad(
      `folder format v${facts.schemaVersion} — v${CURRENT_SCHEMA_VERSION} available (\`velloo upgrade <folder>\`)`,
    );
  } else {
    ok(`folder format v${facts.schemaVersion} (current)`);
  }

  if (facts.toolVersionStale) {
    bad(
      `agent skills recorded for velloo ${String(config.toolVersion)} — refresh with \`velloo upgrade <folder>\``,
    );
  } else {
    ok(`agent skills current (velloo ${TOOL_VERSION})`);
  }

  if (facts.design) ok(`listed as design "${facts.design}"`);
  else bad("not listed in velloo.json — commands must name the path");

  // The application root is the one recorded fact `init` takes from the
  // directory it happened to be run in, so it is the one most likely to be
  // wrong — and reporting it without offering the repair is what left an
  // agent hand-editing a folder it had been told never to touch.
  const app = await recordedAppRoot(folder).catch(() => null);
  if (app) {
    if (!app.exists) bad(`host app ${displayPath(app.path)} no longer exists`);
    else if (!app.looksLikeApp) bad(`host app ${displayPath(app.path)} holds no package.json`);
    else ok(`host app at ${displayPath(app.path)}`);
  }

  const wired = await globallyWiredAgents();
  if (wired.length > 0) ok(`agents wired globally: ${wired.join(", ")}`);
  else bad('no globally wired agents — run init again and pick "Connect agents"');

  const browser = await chromiumExecutable();
  if (browser) ok("browser installed (screenshots + publish)");
  else bad(`no browser for screenshots — install with \`${CHROMIUM_INSTALL_CMD}\``);

  if (!facts.design) {
    const go = await confirm({ message: "List this design in velloo.json?" });
    if (!isCancel(go) && go) {
      try {
        const reg = await registerDesign(folder, appRoot);
        if (reg.created) log.success(`Listed design "${reg.name}" in velloo.json.`);
        else log.info("Already listed.");
      } catch (err) {
        log.warn((err as Error).message);
      }
    }
  }
  if (app && !app.looksLikeApp) await repairAppRoot(folder, app.path);
  if (!browser) await installChromiumInteractive();
}

/** Offer the repo's real applications, and point the folder at the chosen one. */
async function repairAppRoot(folder: string, current: string): Promise<void> {
  const go = await confirm({ message: "Point this design at a different application?" });
  if (isCancel(go) || !go) return;
  const target = await promptAppRootChoice(current);
  if (!target) {
    log.info(
      `No other application found in this repo — \`velloo design set-app-root --to <path>\`.`,
    );
    return;
  }
  const change = await planAppRootChange(folder, target);
  if (resolve(change.to) === resolve(change.from)) return;
  await stopDaemon(daemonRoot(folder));
  await applyAppRootChange(folder, change);
  log.success(`Application root is now ${displayPath(change.to)}.`);
}

/** Start (or attach to) the folder's canvas daemon and print its URL. */
export async function runOpenCanvas(folder: string): Promise<void> {
  const rec = await ensureDaemon(folder);
  console.log(`velloo: canvas at ${rec.canvasUrl}`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
