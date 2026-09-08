import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComponentDescriptor } from "@velloo/provider";
import { componentsDir, loadManifest } from "@velloo/shadcn-snapshot";
import { addNameIndex, findUiDir, installedAddNames } from "../install.ts";
import { createProvider } from "../provider.ts";

describe("addNameIndex", () => {
  test("reads the registry name the manifest recorded", () => {
    const addNameOf = addNameIndex([
      descriptor("ButtonGroupSeparator", "button-group"),
      descriptor("Button", "button"),
      // The two upstream files named after neither their component nor their
      // export, which no id-shaped rule can reach.
      descriptor("Toaster", "sonner"),
      descriptor("DirectionProvider", "direction"),
    ]);
    expect(addNameOf("ButtonGroupSeparator")).toBe("button-group");
    expect(addNameOf("Button")).toBe("button");
    expect(addNameOf("Toaster")).toBe("sonner");
    expect(addNameOf("DirectionProvider")).toBe("direction");
  });

  test("kebabs an id the manifest does not carry", () => {
    // A host-only component, or one upstream added since the snapshot: a guess
    // is all there is, and being wrong only costs a fallback render.
    expect(addNameIndex([])("DropdownMenu")).toBe("dropdown-menu");
  });

  /**
   * The invariant the old hand-kept family list kept breaking. A stale list
   * did not fail closed — a missing family fell through to a shorter one, so
   * `ButtonGroup` resolved to `button.tsx`, which exists and compiles.
   * Pin the whole manifest rather than sampling ids.
   */
  test("every library id resolves to a file the snapshot actually has", async () => {
    const manifest = await loadManifest();
    const addNameOf = addNameIndex(manifest);
    const files = new Set(
      readdirSync(join(componentsDir, "ui")).map((f) => f.replace(/\.\w+$/, "")),
    );
    const unresolved = manifest
      .filter((c) => c.source !== "velloo")
      .map((c) => c.id)
      .filter((id) => !files.has(addNameOf(id)));
    expect(unresolved).toEqual([]);
  });

  /** The lookup is only as good as the build populating it. */
  test("the build records a registry name for every library component", async () => {
    const missing = (await loadManifest())
      .filter((c) => c.source !== "velloo" && !c.registryName)
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});

function descriptor(id: string, registryName: string): ComponentDescriptor {
  return { id, category: "ui", source: "shadcn", registryName, props: [] };
}

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
