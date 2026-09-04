import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
