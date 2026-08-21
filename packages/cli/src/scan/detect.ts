import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/** Major version parsed from a semver range like `^4.0.0` / `~3.4.1` / `4`. */
function majorOf(range: string | undefined): number | null {
  if (!range) return null;
  const m = range.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Inspect the host app to decide what `scan` is working with: its shadcn
 * style and Tailwind major version, plus the global stylesheet to import a
 * theme from. Best-effort and side-effect-free — every field degrades to a
 * safe unknown rather than throwing, so an exotic project still scans.
 */
export function detectHost(appRoot: string): DetectedHost {
  const pkg = readJson(join(appRoot, "package.json")) ?? {};
  const deps: Record<string, unknown> = {
    ...((pkg.dependencies as Record<string, unknown>) ?? {}),
    ...((pkg.devDependencies as Record<string, unknown>) ?? {}),
  };

  // Tailwind major: prefer the explicit `tailwindcss` range; fall back to the
  // v4-only adapter packages, which imply v4 even when `tailwindcss` is pinned
  // transitively.
  let tailwindMajor: 3 | 4 | null = null;
  const twMajor = majorOf(depRange(deps, "tailwindcss"));
  if (twMajor !== null) tailwindMajor = twMajor >= 4 ? 4 : 3;
  else if (depRange(deps, "@tailwindcss/vite") || depRange(deps, "@tailwindcss/postcss"))
    tailwindMajor = 4;

  const componentsJson = readJson(join(appRoot, "components.json"));
  const shadcn = componentsJson !== null;
  const shadcnStyle =
    typeof componentsJson?.style === "string" ? (componentsJson.style as string) : undefined;

  // UI framework inference for the "existing project" flow. MUI is the strong
  // signal (a real npm dependency); shadcn is inferred from `components.json`.
  // MUI wins if both somehow appear — a `@mui/material` install is concrete,
  // a stray components.json is not.
  const uiLibrary: DetectedHost["uiLibrary"] = depRange(deps, "@mui/material")
    ? "mui"
    : shadcn
      ? "shadcn"
      : undefined;

  // A UI framework velloo doesn't adapt — only relevant when no supported one
  // was found, so the scan can fall back to the no-framework (div) adapter.
  const unsupportedUi = uiLibrary ? undefined : detectUnsupportedUi(deps);

  return {
    shadcn,
    shadcnStyle,
    tailwindMajor,
    globalsCssPath: findGlobalsCss(appRoot, componentsJson),
    ...(uiLibrary ? { uiLibrary } : {}),
    ...(unsupportedUi ? { unsupportedUi } : {}),
  };
}

/** Known UI frameworks velloo has no adapter for → display name, or undefined. */
function detectUnsupportedUi(deps: Record<string, unknown>): string | undefined {
  const known: Array<[string, string]> = [
    ["@chakra-ui/react", "Chakra UI"],
    ["@mantine/core", "Mantine"],
    ["antd", "Ant Design"],
    ["@ant-design/web3", "Ant Design"],
    ["@nextui-org/react", "NextUI"],
    ["@heroui/react", "HeroUI"],
    ["react-bootstrap", "React Bootstrap"],
    ["@fluentui/react-components", "Fluent UI"],
  ];
  for (const [pkg, label] of known) if (depRange(deps, pkg)) return label;
  return undefined;
}

/** Best-effort location of the host's global stylesheet (the theme source). */
export function findGlobalsCss(
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
