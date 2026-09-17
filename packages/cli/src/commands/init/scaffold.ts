import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  BoardSchema,
  ConfigSchema,
  type HostApp,
  ScreenSchema,
  SnippetSchema,
  type Theme,
  ThemeSchema,
} from "@velloo/schema";
import { writeJsonAtomic, writeText } from "@velloo/server";
import { buildDefaultConfig } from "../../scaffold/default-config.ts";
import {
  componentScaffold,
  customRequestScaffold,
  redesignScreenScaffold,
} from "../../scaffold/goal-scaffolds.ts";
import { findMuiTheme, importThemeFromMui } from "../../scaffold/import-mui-theme.ts";
import { importThemeFromGlobals } from "../../scaffold/import-theme.ts";
import type { Scaffold } from "../../scaffold/scaffold.ts";
import { buildPresetTheme, DEFAULT_THEME_PRESET } from "../../scaffold/theme-presets.ts";
import {
  appPrefixes,
  buildBoardsFromScan,
  buildScreensFromScan,
  scanAppRoutes,
} from "../../scan/index.ts";
import type { WizardAnswers } from "../../wizard/answers.ts";
import {
  type InstallPlan,
  sampleScaffold,
  WIZARD_PROVIDERS,
} from "../../wizard/provider-registry.ts";
import { renderDesignReadme } from "../../wizard/readme.ts";
import { stackById } from "../../wizard/stacks.ts";

export async function isEmptyOrMissing(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path);
    return entries.length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }
}

function blankScaffold(theme: Theme): Scaffold {
  return {
    theme,
    screens: [],
    boards: [],
    snippets: [],
    annotations: [],
    notes: [],
  };
}

/**
 * The scaffold's theme: for scan we import the host app's globals.css so the
 * canvas renders in their brand; everything else uses the chosen preset.
 */
/**
 * The preset a scaffold is themed with when nothing is imported: an explicit
 * choice, else zinc for a blank folder (neutral until someone styles it), else
 * the sample's own.
 */
export function themePresetFor(answers: WizardAnswers): string {
  return (
    answers.themePreset ?? (answers.initialContent === "blank" ? "zinc" : DEFAULT_THEME_PRESET)
  );
}

export function resolveTheme(answers: WizardAnswers): { theme: Theme; importedFrom?: string } {
  // Prefer the host app's theme whenever detection found one (scan, redesign,
  // component after auto-adopt, etc.).
  if (answers.detected) {
    if (answers.detected.uiLibrary === "mui") {
      const themeFile = findMuiTheme(answers.scanRoot);
      if (themeFile) {
        const imported = importThemeFromMui(themeFile, answers.themePreset);
        if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
      }
    }
    if (answers.detected.globalsCssPath) {
      const imported = importThemeFromGlobals(answers.detected.globalsCssPath, answers.themePreset);
      if (imported) return { theme: imported.theme, importedFrom: imported.importedFrom };
    }
  }
  return { theme: buildPresetTheme(themePresetFor(answers)) };
}

export async function buildScaffold(answers: WizardAnswers, theme: Theme): Promise<Scaffold> {
  if (answers.initialContent === "blank") {
    return blankScaffold(theme);
  }
  if (answers.initialContent === "component") {
    return componentScaffold(theme, answers.componentDescription ?? "Component");
  }
  if (answers.initialContent === "custom") {
    return customRequestScaffold(theme);
  }
  if (answers.initialContent === "redesign-screen") {
    if (answers.selectedRoutes && answers.selectedRoutes.length > 0) {
      const routes = answers.selectedRoutes;
      const screens = buildScreensFromScan({
        routes,
        ...WIZARD_PROVIDERS[answers.library].scanScreenOpts,
      });
      const boards = buildBoardsFromScan({ routes });
      return { theme, screens, boards, snippets: [], annotations: [], notes: [] };
    }
    return redesignScreenScaffold(theme, answers.screenName ?? "Screen");
  }

  if (answers.initialContent === "scan") {
    // Legacy multi-route scan (non-interactive --start=scan).
    const routes = answers.selectedRoutes ?? (await scanAppRoutes(answers.scanRoot)).routes;
    if (routes.length === 0) {
      return blankScaffold(theme);
    }
    const screens = buildScreensFromScan({
      routes,
      ...WIZARD_PROVIDERS[answers.library].scanScreenOpts,
    });
    const boards = buildBoardsFromScan({ routes });
    return { theme, screens, boards, snippets: [], annotations: [], notes: [] };
  }

  // The complete Elsewhere sample composed for the selected library.
  return sampleScaffold(answers, theme);
}

function defaultScreenForScaffold(scaffold: Scaffold): string | undefined {
  if (scaffold.screens.find((s) => s.id === "landing")) return "landing";
  return scaffold.screens[0]?.id;
}

export async function writeScaffold(
  folder: string,
  scaffold: Scaffold,
  plan: InstallPlan,
  answers: WizardAnswers,
  name: string,
  /** A local design outside the checkout — its README names the app symbolically. */
  local = false,
): Promise<void> {
  // Point the live-island bundler at the host app. `scanRoot` is the primary
  // app root (the app itself, even when nested under a monorepo `appRoot`);
  // store it relative to the design folder, which is how the bundler resolves
  // it (`resolve(folderRoot, hostApp.root)`). Aliases are left to the
  // bundler's `{ "@/*": "*" }` default — reading the host tsconfig per the
  // codebase stance is fragile; apps with a non-root `@` alias edit it once.
  const hostAppRoot = relative(folder, answers.scanRoot).split(sep).join("/");
  // A multi-app scan also registers every route-bearing app under
  // `config.hostApps`, keyed by the same prefixes the screen ids use, so a
  // live extension can target its app via `extension.app`.
  const appRels = [
    ...new Set((answers.selectedRoutes ?? []).map((r) => r.appRel).filter(Boolean)),
  ] as string[];
  let hostApps: Record<string, HostApp> | undefined;
  if (appRels.length > 1) {
    const prefixes = appPrefixes(appRels);
    hostApps = {};
    for (const rel of appRels) {
      const key = prefixes.get(rel);
      if (key)
        hostApps[key] = {
          root: relative(folder, resolve(answers.appRoot, rel)).split(sep).join("/"),
        };
    }
  }
  // CSS framework (the styling axis): only the no-framework library has a real
  // choice — shadcn carries Tailwind and MUI carries `sx` intrinsically. Each
  // provider's registry entry decides.
  const styling = WIZARD_PROVIDERS[answers.library].stylingFor(answers);
  // The stack prompt's one output: emit_code mentions imports under the
  // alias the user's app actually resolves.
  const stack = stackById(answers.stack);
  const hostAliases = componentAliases(stack?.alias, answers.componentsRelative);
  const config = buildDefaultConfig({
    name,
    library: plan.library,
    defaultScreen: defaultScreenForScaffold(scaffold),
    defaultBoard: scaffold.boards[0]?.id,
    ...(hostAppRoot
      ? { hostApp: { root: hostAppRoot, ...(hostAliases ? { aliases: hostAliases } : {}) } }
      : {}),
    ...(hostApps ? { hostApps } : {}),

    ...(styling ? { styling } : {}),
    codegen: {
      ...(stack ? { componentsAlias: stack.alias } : {}),
      componentsDir: answers.componentsRelative,
    },
  });
  config.boardOrder = scaffold.boards.map((b) => b.id);
  ConfigSchema.parse(config);
  ThemeSchema.parse(scaffold.theme);
  for (const screen of scaffold.screens) ScreenSchema.parse(screen);
  for (const board of scaffold.boards) BoardSchema.parse(board);
  for (const snippet of scaffold.snippets) SnippetSchema.parse(snippet);

  // Ensure the standard layout exists even on blank inits, so the
  // canvas + watcher have predictable parents and `readdir` calls
  // (in tests or downstream tools) succeed.
  await Promise.all([
    mkdir(`${folder}/screens`, { recursive: true }),
    mkdir(`${folder}/boards`, { recursive: true }),
    mkdir(`${folder}/snippets`, { recursive: true }),
  ]);

  // `.design/cache/` is daemon runtime state (lockfiles, logs — recreated on
  // demand) and `.velloo/` holds trace tapes; both are local and regenerated,
  // so they're ignored rather than tracked. The cache dir no longer needs a
  // committed `.gitkeep` — the daemon mkdirs it on startup.
  const gitignore = [
    "# Velloo runtime + debug artifacts — regenerated on demand, never commit.",
    ".design/cache/",
    ".velloo/",
    "",
  ].join("\n");
  const writes: Promise<unknown>[] = [
    writeJsonAtomic(`${folder}/.design/config.json`, config),
    writeJsonAtomic(`${folder}/theme/default.json`, scaffold.theme),
    writeText(`${folder}/.gitignore`, gitignore),
    writeText(`${folder}/assets/.gitkeep`, ""),
    writeText(`${folder}/README.md`, renderDesignReadme(answers, plan, local)),
  ];
  for (const s of scaffold.screens) {
    writes.push(writeJsonAtomic(`${folder}/screens/${s.id}.json`, s));
  }
  for (const b of scaffold.boards) {
    writes.push(writeJsonAtomic(`${folder}/boards/${b.id}.json`, b));
  }
  for (const s of scaffold.snippets) {
    writes.push(writeJsonAtomic(`${folder}/snippets/${s.id}.json`, s));
  }
  for (const notes of scaffold.notes)
    writes.push(writeJsonAtomic(`${folder}/boards/${notes.boardId}.notes.json`, notes.entries));
  for (const annotations of scaffold.annotations)
    writes.push(
      writeJsonAtomic(
        `${folder}/screens/${annotations.screenId}.annotations.json`,
        annotations.entries,
      ),
    );
  if (scaffold.customCss) writes.push(writeText(`${folder}/theme/custom.css`, scaffold.customCss));
  if (scaffold.assetMetadata)
    writes.push(writeJsonAtomic(`${folder}/assets.json`, scaffold.assetMetadata));
  for (const [path, text] of Object.entries(scaffold.documents ?? {}))
    writes.push(writeText(join(folder, path), text));
  await mkdir(join(folder, "assets"), { recursive: true });
  for (const [path, source] of Object.entries(scaffold.assetFiles ?? {}))
    writes.push(copyFile(source, join(folder, path)));
  await Promise.all(writes);
}

function componentAliases(
  componentsAlias: string | undefined,
  componentsRelative: string,
): Record<string, string> | undefined {
  const alias = componentsAlias ?? "@/components/ui";
  const marker = "/components/ui";
  const aliasAt = alias.lastIndexOf(marker);
  const pathAt = componentsRelative.replaceAll("\\", "/").lastIndexOf(marker.slice(1));
  if (aliasAt < 0 || pathAt < 0) return undefined;
  const from = `${alias.slice(0, aliasAt).replace(/\/$/, "")}/*`;
  const base = componentsRelative.replaceAll("\\", "/").slice(0, pathAt).replace(/\/$/, "");
  return { [from]: base ? `${base}/*` : "*" };
}
