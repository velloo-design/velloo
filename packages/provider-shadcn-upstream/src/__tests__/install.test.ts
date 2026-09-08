import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { componentsDir, loadManifest } from "@velloo/shadcn-snapshot";
import { findUiDir, installedAddNames, shadcnAddName } from "../install.ts";
import { createProvider } from "../provider.ts";

describe("shadcnAddName", () => {
  test("roots kebab directly", () => {
    expect(shadcnAddName("Button")).toBe("button");
    expect(shadcnAddName("Card")).toBe("card");
  });

  test("parts resolve to their longest family, not a shorter prefix", () => {
    expect(shadcnAddName("AlertDialogAction")).toBe("alert-dialog");
    expect(shadcnAddName("AccordionContent")).toBe("accordion");
    expect(shadcnAddName("ToggleGroupItem")).toBe("toggle-group");
    expect(shadcnAddName("ToggleGroup")).toBe("toggle-group");
  });

  test("registry-name exceptions", () => {
    expect(shadcnAddName("Toaster")).toBe("sonner");
    expect(shadcnAddName("ScrollBar")).toBe("scroll-area");
    expect(shadcnAddName("DirectionProvider")).toBe("direction");
  });

  test("a longer family wins over a shorter one that prefixes it", () => {
    expect(shadcnAddName("ButtonGroup")).toBe("button-group");
    expect(shadcnAddName("ButtonGroupSeparator")).toBe("button-group");
    expect(shadcnAddName("InputGroupAddon")).toBe("input-group");
  });

  /**
   * The family list is hand-maintained against the snapshot pull, so it goes
   * stale silently: a missing family makes an id resolve to some *other*
   * family's file (`ButtonGroup` → `button.tsx`), which exists and compiles.
   * Nothing throws — the canvas imports it, `pick` finds no such export, and
   * React gets a module namespace object. Pin the whole manifest instead of
   * sampling ids.
   */
  test("every library id resolves to a file the snapshot actually has", async () => {
    const files = new Set(
      readdirSync(join(componentsDir, "ui")).map((f) => f.replace(/\.\w+$/, "")),
    );
    const unresolved = (await loadManifest())
      .filter((c) => c.source !== "velloo")
      .map((c) => c.id)
      .filter((id) => !files.has(shadcnAddName(id)));
    expect(unresolved).toEqual([]);
  });
});

async function fakeApp(withComponentsJson: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velloo-upstream-app-"));
  await mkdir(join(root, "src", "components", "ui"), { recursive: true });
  await writeFile(join(root, "src", "components", "ui", "button.tsx"), "export {}\n");
  await writeFile(join(root, "src", "components", "ui", "alert-dialog.tsx"), "export {}\n");
  if (withComponentsJson) {
    await writeFile(
      join(root, "components.json"),
      JSON.stringify({ aliases: { ui: "@/components/ui" } }),
    );
  }
  return root;
}

describe("installed detection", () => {
  test("resolves the ui dir from components.json aliases", async () => {
    const root = await fakeApp(true);
    expect(findUiDir(root)).toBe(join(root, "src", "components", "ui"));
    expect(installedAddNames(root)).toEqual(new Set(["button", "alert-dialog"]));
  });

  test("falls back to conventional locations without components.json", async () => {
    const root = await fakeApp(false);
    expect(findUiDir(root)).toBe(join(root, "src", "components", "ui"));
  });

  test("no app dirs at all → nothing installed", async () => {
    const empty = await mkdtemp(join(tmpdir(), "velloo-upstream-empty-"));
    expect(findUiDir(empty)).toBeNull();
    expect(installedAddNames(empty).size).toBe(0);
  });
});

describe("adapter catalog", () => {
  test("catalog reports real installed status against the host app", async () => {
    const root = await fakeApp(true);
    const provider = createProvider({ hostAppRoot: root });
    const catalog = await provider.catalog?.();
    if (!catalog) throw new Error("upstream must declare a catalog");
    const byId = new Map(catalog.map((e) => [e.id, e]));
    expect(byId.get("Button")?.installed).toBe(true);
    expect(byId.get("Button")?.importPath).toBe("@/components/ui/button");
    expect(byId.get("AlertDialogAction")?.installed).toBe(true);
    expect(byId.get("Tabs")?.installed).toBe(false);
    // velloo helpers are built-ins, not catalog entries.
    expect(byId.has("Icon")).toBe(false);
  });
});
