import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Real per-component install for shadcn-upstream: shell out to the framework's
 * own CLI (`npx shadcn@latest add <name>`) against the user's app, exactly the
 * command the agent handoff has always suggested — now callable through the
 * `install_component` MCP tool. Everything here is pure/deterministic except
 * the spawn itself, so the mapping + validation are unit-testable without
 * touching the network.
 */

/** PascalCase → shadcn registry name ("DropdownMenu" → "dropdown-menu"). */
function kebab(id: string): string {
  return id.replace(/(?<!^)(?=[A-Z])/g, "-").toLowerCase();
}

/**
 * The shadcn registry's installable families (one file each), PascalCase —
 * the vendored snapshot's component surface. Part ids extend their family's
 * name (`AlertDialogAction` → `AlertDialog`), so the longest family prefix
 * identifies the file to install. Kept in sync with the snapshot pull the
 * same way `snapshotVersion` is.
 */
const SHADCN_FAMILIES = [
  "Accordion",
  "Alert",
  "AlertDialog",
  "Avatar",
  "Badge",
  "Breadcrumb",
  "Button",
  "Calendar",
  "Card",
  "Carousel",
  "Chart",
  "Checkbox",
  "Collapsible",
  "Dialog",
  "DropdownMenu",
  "Input",
  "Label",
  "Pagination",
  "Popover",
  "Progress",
  "RadioGroup",
  "ScrollArea",
  "Select",
  "Separator",
  "Sheet",
  "Skeleton",
  "Slider",
  "Switch",
  "Table",
  "Tabs",
  "Textarea",
  "Toggle",
  "ToggleGroup",
  "Tooltip",
] as const;

/** Ids whose registry name isn't the kebab of a family prefix. */
const ADD_NAME_EXCEPTIONS: Record<string, string> = {
  Toaster: "sonner",
  ScrollBar: "scroll-area",
};

/**
 * The shadcn CLI's installable unit for a manifest id: the longest family
 * whose PascalCase name prefixes the id (`AlertDialogAction` → `alert-dialog`,
 * `ToggleGroupItem` → `toggle-group`). Unknown ids kebab directly, so a future
 * upstream component still gets a sane registry name.
 */
export function shadcnAddName(id: string): string {
  const exception = ADD_NAME_EXCEPTIONS[id];
  if (exception) return exception;
  const family = SHADCN_FAMILIES.filter((f) => id.startsWith(f)).sort(
    (a, b) => b.length - a.length,
  )[0];
  return kebab(family ?? id);
}

/** The pinned install command, argv form — never a shell string. */
export function buildInstallArgv(addName: string): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(addName)) {
    throw new Error(`shadcn install: "${addName}" is not a valid registry name`);
  }
  return ["npx", "shadcn@latest", "add", addName, "--yes"];
}

/**
 * Where the app's shadcn ui components live. Prefers the app's own
 * `components.json` (`aliases.ui` / `aliases.components`, `@/` mapped onto
 * `src/` when it exists), then the conventional locations. Null when the app
 * has no discoverable ui dir yet (nothing installed).
 */
export function findUiDir(hostAppRoot: string): string | null {
  const candidates: string[] = [];
  try {
    const cj = JSON.parse(readFileSync(join(hostAppRoot, "components.json"), "utf8")) as {
      aliases?: { ui?: string; components?: string };
    };
    const fromAlias = (alias: string | undefined, suffix = ""): void => {
      if (!alias) return;
      const srcBase = existsSync(join(hostAppRoot, "src")) ? "src" : "";
      const rel = alias.replace(/^@\//, srcBase ? `${srcBase}/` : "") + suffix;
      candidates.push(resolve(hostAppRoot, rel));
    };
    fromAlias(cj.aliases?.ui);
    fromAlias(cj.aliases?.components, "/ui");
  } catch {
    // No components.json (or unreadable) — fall through to conventions.
  }
  candidates.push(
    resolve(hostAppRoot, "src/components/ui"),
    resolve(hostAppRoot, "components/ui"),
    resolve(hostAppRoot, "app/components/ui"),
  );
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

/** Registry names (kebab) already present as files in the app's ui dir. */
export function installedAddNames(hostAppRoot: string): Set<string> {
  const dir = findUiDir(hostAppRoot);
  if (!dir) return new Set();
  try {
    return new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => f.replace(/\.(tsx|ts)$/, "")),
    );
  } catch {
    return new Set();
  }
}

export interface RunInstallOptions {
  hostAppRoot: string;
  addName: string;
}

/**
 * Spawn the pinned install command in the host app. Throws with the tail of
 * stderr on a non-zero exit; the MCP layer surfaces that as a tool error.
 */
export async function runShadcnAdd(opts: RunInstallOptions): Promise<void> {
  const argv = buildInstallArgv(opts.addName);
  const proc = Bun.spawn(argv, {
    cwd: opts.hostAppRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) {
    const tail = stderr.trim().split("\n").slice(-6).join("\n");
    throw new Error(`\`${argv.join(" ")}\` exited ${code}${tail ? `:\n${tail}` : ""}`);
  }
}
