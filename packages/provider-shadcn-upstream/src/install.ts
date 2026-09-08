import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Read-only shadcn host-app discovery. Design composition resolves against
 * Velloo's bundled runtime; emission reports these registry names when the
 * host app still needs a component.
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
  "AspectRatio",
  "Attachment",
  "Avatar",
  "Badge",
  "Breadcrumb",
  "Bubble",
  "Button",
  "ButtonGroup",
  "Calendar",
  "Card",
  "Carousel",
  "Chart",
  "Checkbox",
  "Collapsible",
  "Combobox",
  "ContextMenu",
  "Dialog",
  "Drawer",
  "DropdownMenu",
  "Empty",
  "Field",
  "HoverCard",
  "Input",
  "InputGroup",
  "Item",
  "Kbd",
  "Label",
  "Marker",
  "Menubar",
  "Message",
  "NativeSelect",
  "NavigationMenu",
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
  "Spinner",
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
  DirectionProvider: "direction",
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
