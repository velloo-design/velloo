import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { detectTailwindMajor } from "@velloo/codegen";
import { findDesignSystemIn, tsconfigAliases } from "@velloo/server";
import type { DetectedHost } from "../wizard/answers.ts";

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function depRange(deps: Record<string, unknown>, name: string): string | undefined {
  const v = deps[name];
  return typeof v === "string" ? v : undefined;
}

function hasHtmxTemplates(appRoot: string): boolean {
  for (const rel of [
    "templates/layout.html",
    "templates/base.html",
    "templates/index.html",
    "index.html",
  ]) {
    try {
      if (
        /\bhx-[\w-]+\s*=|htmx(?:\.min)?(?:-[\d.]+)?\.js/i.test(
          readFileSync(join(appRoot, rel), "utf8"),
        )
      )
        return true;
    } catch {
      /* no template at this path */
    }
  }
  return false;
}

/**
 * Inspect the host app to decide what `scan` is working with: its shadcn
 * style and Tailwind major version, plus the global stylesheet to import a
 * theme from. Best-effort and side-effect-free — every field degrades to a
 * safe unknown rather than throwing, so an exotic project still scans.
 *
 * `repoRoot` is the directory init runs in, when the app is nested below it:
 * a monorepo keeps one DESIGN.md for several apps there.
 */
export function detectHost(appRoot: string, repoRoot: string = appRoot): DetectedHost {
  const pkg = readJson(join(appRoot, "package.json")) ?? {};
  const deps: Record<string, unknown> = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };

  // Tailwind major: shared with the codegen emit paths, which route v3/v4
  // theme artifacts on the same signal.
  const tailwindMajor = detectTailwindMajor(appRoot);

  const componentsJson = readJson(join(appRoot, "components.json"));
  const shadcn = componentsJson !== null;
  const shadcnStyle =
    typeof componentsJson?.style === "string" ? (componentsJson.style as string) : undefined;

  // UI framework inference for the "existing project" flow. MUI, antd, and
  // chakra are the strong signals (real npm dependencies); shadcn is inferred
  // from `components.json`. A concrete install wins over a stray
  // components.json; if several somehow appear, precedence is
  // mui > antd > chakra.
  const uiLibrary: DetectedHost["uiLibrary"] =
    depRange(deps, "htmx.org") || depRange(deps, "htmx") || hasHtmxTemplates(appRoot)
      ? "html"
      : depRange(deps, "@mui/material")
        ? "mui"
        : depRange(deps, "antd")
          ? "antd"
          : depRange(deps, "@chakra-ui/react")
            ? "chakra"
            : shadcn
              ? "shadcn"
              : undefined;

  // A UI framework velloo doesn't adapt — only relevant when no supported one
  // was found, so the scan can fall back to the no-framework (div) adapter.
  const unsupportedUi = uiLibrary ? undefined : detectUnsupportedUi(deps);
  // The same places, and the same test, the design will use to follow it.
  const designMdPath = findDesignSystemIn([appRoot, repoRoot]) ?? undefined;

  return {
    shadcn,
    shadcnStyle,
    tailwindMajor,
    globalsCssPath: findGlobalsCss(appRoot, componentsJson),
    ...(designMdPath ? { designMdPath } : {}),
    ...(uiLibrary ? { uiLibrary } : {}),
    ...(unsupportedUi ? { unsupportedUi } : {}),
  };
}

/**
 * Directories apps conventionally keep UI components in, most common first.
 * Used to answer the wizard's "components subfolder" question from the app
 * itself instead of asking.
 */
const COMPONENT_DIR_CANDIDATES = [
  "src/components/ui",
  "components/ui",
  "app/components/ui",
  "src/app/components/ui",
  "src/components",
  "components",
];

/**
 * The app's existing UI-component directory (relative to `appRoot`), or
 * undefined when none of the conventional locations exist. A shadcn app says
 * where its components are — `components.json`'s `aliases.ui` through the
 * tsconfig path map — and that beats guessing: an app that keeps its client
 * under `src/client/` has none of the conventional directories.
 */
export function findComponentsDir(appRoot: string): string | undefined {
  return (
    componentsJsonUiDir(appRoot) ??
    COMPONENT_DIR_CANDIDATES.find((rel) => existsSync(join(appRoot, rel)))
  );
}

function componentsJsonUiDir(appRoot: string): string | undefined {
  const aliases = readJson(join(appRoot, "components.json"))?.aliases as
    | { ui?: unknown; components?: unknown }
    | undefined;
  const ui =
    typeof aliases?.ui === "string"
      ? aliases.ui
      : typeof aliases?.components === "string"
        ? `${aliases.components}/ui`
        : undefined;
  if (ui === undefined) return undefined;
  for (const { from, to } of tsconfigAliases(appRoot)) {
    if (!from || !ui.startsWith(from)) continue;
    const rel = posix.normalize(`${to}${ui.slice(from.length)}`).replace(/\/$/, "");
    if (existsSync(join(appRoot, rel))) return rel;
  }
  return undefined;
}

/** Known UI frameworks velloo has no adapter for → display name, or undefined. */
function detectUnsupportedUi(deps: Record<string, unknown>): string | undefined {
  const known: Array<[string, string]> = [
    ["@mantine/core", "Mantine"],
    ["@nextui-org/react", "NextUI"],
    ["@heroui/react", "HeroUI"],
    ["react-bootstrap", "React Bootstrap"],
    ["@fluentui/react-components", "Fluent UI"],
    // Untitled UI ships as copy-paste sources (no component dep) — its icon
    // packages are the reliable install signal. Listed before the react-aria
    // base it builds on so the more specific name wins.
    ["@untitledui/icons", "Untitled UI"],
    ["@untitledui/file-icons", "Untitled UI"],
    ["react-aria-components", "React Aria"],
  ];
  for (const [pkg, label] of known) if (depRange(deps, pkg)) return label;
  return undefined;
}

/** Best-effort location of the host's global stylesheet (the theme source). */
function findGlobalsCss(
  appRoot: string,
  componentsJson: Record<string, unknown> | null,
): string | undefined {
  const fromConfig =
    componentsJson && typeof (componentsJson.tailwind as { css?: unknown })?.css === "string"
      ? ((componentsJson.tailwind as { css: string }).css as string)
      : undefined;
  const candidates = [
    fromConfig,
    "src/app/globals.css",
    "app/globals.css",
    "src/styles/globals.css",
    "styles/globals.css",
    "src/index.css",
    "src/globals.css",
    "src/app.css",
  ].filter((c): c is string => Boolean(c));
  for (const rel of candidates) {
    const abs = join(appRoot, rel);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}
