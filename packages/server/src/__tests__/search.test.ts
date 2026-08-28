import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { searchFolder } from "../search.ts";

const config = {
  schemaVersion: 2,
  toolVersion: "test",
  libraries: {
    default: {
      id: "shadcn-upstream",
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  boardOrder: ["invoices", "flows"],
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const theme = {
  name: "test",
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const billingScreen = {
  id: "billing-settings",
  name: "Billing settings",
  tree: {
    $ref: "Box",
    props: { className: "invoice-anchor flex flex-col" },
    children: [
      { $ref: "Heading", $id: "title", props: { children: "Invoice #4021 — payment overdue" } },
      { $ref: "Input", props: { placeholder: "Search invoices" } },
      { $ref: "Button", props: { children: "Download invoice as PDF" } },
      { $snippet: "pricing-row", args: { label: "Invoice total", amount: 42 } },
    ],
  },
};

const checkoutScreen = {
  id: "checkout",
  name: "Checkout",
  tree: {
    $ref: "Box",
    children: [{ $ref: "Text", props: { children: "Thanks for your order" } }],
  },
};

const invoicesBoard = {
  id: "invoices",
  name: "Invoices",
  frames: [
    { id: "f1", screen: "billing-settings", x: 0, y: 0, w: 1440, h: 900 },
    { id: "f2", screen: "checkout", x: 1500, y: 0, w: 390, h: 844 },
  ],
  groups: [],
};

const flowsBoard = {
  id: "flows",
  name: "Flows",
  frames: [{ id: "f3", screen: "billing-settings", x: 0, y: 0, w: 1440, h: 900 }],
  groups: [],
};

let tmp: string;
let folder: DesignFolder;

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-search-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "boards"), { recursive: true });
  await writeJson(join(tmp, ".design", "config.json"), config);
  await writeJson(join(tmp, "theme", "default.json"), theme);
  await writeJson(join(tmp, "screens", "billing-settings.json"), billingScreen);
  await writeJson(join(tmp, "screens", "checkout.json"), checkoutScreen);
  await writeJson(join(tmp, "boards", "invoices.json"), invoicesBoard);
  await writeJson(join(tmp, "boards", "flows.json"), flowsBoard);
  folder = await loadDesignFolder(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("searchFolder", () => {
  test("matches board and screen names case-insensitively, including ids", () => {
    const r = searchFolder(folder, "INVOICE");
    expect(r.boards.map((b) => b.id)).toEqual(["invoices"]);
    expect(r.boards[0]?.frameCount).toBe(2);
    // "billing-settings" doesn't name-match "invoice"; no screen hits.
    expect(r.screens).toEqual([]);

    const byId = searchFolder(folder, "billing-set");
    expect(byId.screens.map((s) => s.id)).toEqual(["billing-settings"]);
  });

  test("screen hits list hosting boards in sidebar order", () => {
    const r = searchFolder(folder, "billing");
    expect(r.screens[0]?.boards.map((b) => b.id)).toEqual(["invoices", "flows"]);
  });

  test("finds text in children and placeholder, not className", () => {
    const r = searchFolder(folder, "invoice");
    const props = r.text.map((t) => t.prop).sort();
    // Heading children + Input placeholder + Button children + snippet arg —
    // never the Box whose className contains "invoice-anchor".
    expect(props).toEqual(["children", "children", "label", "placeholder"]);
    expect(r.text.every((t) => t.ref !== "Box")).toBe(true);
    expect(r.textTotal).toBe(4);
  });

  test("text hits carry path, node identity, and hosting board", () => {
    const r = searchFolder(folder, "overdue");
    expect(r.text).toHaveLength(1);
    const hit = r.text[0];
    expect(hit?.path).toEqual([0]);
    expect(hit?.ref).toBe("Heading");
    expect(hit?.nodeId).toBe("title");
    expect(hit?.screenId).toBe("billing-settings");
    expect(hit?.board?.id).toBe("invoices");
    expect(hit?.excerpt.slice(hit.matchStart, hit.matchEnd)).toBe("overdue");
  });

  test("matches snippet-instance string args", () => {
    const r = searchFolder(folder, "invoice total");
    expect(r.text).toHaveLength(1);
    expect(r.text[0]?.kind).toBe("snippet");
    expect(r.text[0]?.ref).toBe("pricing-row");
    expect(r.text[0]?.prop).toBe("label");
  });

  test("long values are ellipsized around the match with a correct range", () => {
    const long = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
    folder.screens.set("long", {
      id: "long",
      name: "Long",
      tree: { $ref: "Text", props: { children: long } },
    } as typeof folder.screens extends Map<string, infer S> ? S : never);
    const r = searchFolder(folder, "needle");
    const hit = r.text[0];
    expect(hit?.excerpt.length).toBeLessThanOrEqual(122);
    expect(hit?.excerpt.startsWith("…")).toBe(true);
    expect(hit?.excerpt.slice(hit.matchStart, hit.matchEnd)).toBe("needle");
  });

  test("respects the text limit but reports the true total", () => {
    const r = searchFolder(folder, "invoice", 2);
    expect(r.text).toHaveLength(2);
    expect(r.textTotal).toBe(4);
  });

  test("blank query returns nothing", () => {
    const r = searchFolder(folder, "   ");
    expect(r.boards).toEqual([]);
    expect(r.screens).toEqual([]);
    expect(r.text).toEqual([]);
  });
});
