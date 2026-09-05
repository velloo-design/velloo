import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddNodeBody, normalizeAddNode } from "@velloo/protocol";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { ActivityEvent } from "../../../activity.ts";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import { runBatch } from "../../../mutations/batch.ts";
import { badRequest, scalarChildrenHint } from "../../../mutations/errors.ts";
import type { MutationContext } from "../../../mutations/index.ts";
import { designConfig, designTheme } from "../../../testing/design-folder.ts";

import type { WatchEvent } from "../../../watcher.ts";

/**
 * Guards the "did you mean props.children?" nudge for the scalar-as-children
 * footgun across every surface that can hit it: the detector itself, the
 * `batch` and the shared body + normalization
 * both of them now run. The scalar reaches a handler on purpose — the schema
 * admits it so the answer can be this nudge rather than an opaque
 * "expected array".
 */

const provider = createShadcnProvider();

const sampleConfig = designConfig();

const sampleTheme = designTheme({
  colors: {
    background: "#fff",
    foreground: "#000",
    primary: { DEFAULT: "#000", foreground: "#fff" },
  },
});

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: (WatchEvent | ActivityEvent)[];

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-hint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/landing.json"), {
    id: "landing",
    name: "Landing",
    tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
  });
  folder = await loadDesignFolder(tmp);
  events = [];
  ctx = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("scalarChildrenHint detector", () => {
  test("matches an invalid_type expected-array issue at a children path", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "array", path: ["tree", "children"] },
    ]);
    expect(hint).toBeDefined();
    expect(hint).toContain("props.children");
  });

  test("does not match unrelated array errors (different path)", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "array", path: ["patches"] },
    ]);
    expect(hint).toBeUndefined();
  });

  test("does not match a non-array invalid_type at children (e.g. expected string)", () => {
    const hint = scalarChildrenHint([
      { code: "invalid_type", expected: "string", path: ["children"] },
    ]);
    expect(hint).toBeUndefined();
  });

  test("badRequest attaches the hint when issues carry the scalar-children shape", () => {
    const e = badRequest("Request body failed validation.", [
      { code: "invalid_type", expected: "array", path: ["children"] },
    ]);
    expect(e.kind).toBe("BadRequest");
    if (e.kind === "BadRequest") {
      expect(e.hint).toContain("props.children");
    }
  });

  test("badRequest stays hint-free for an unrelated validation error", () => {
    const e = badRequest("Request body failed validation.", [
      { code: "invalid_type", expected: "string", path: ["screenId"] },
    ]);
    if (e.kind === "BadRequest") {
      expect(e.hint).toBeUndefined();
      // No-hint case must serialize without a `hint` key.
      expect(JSON.parse(JSON.stringify(e))).not.toHaveProperty("hint");
    }
  });
});

describe("batch path", () => {
  test('add_node with children: "Save" rolls back with a hinted BadRequest', async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: { screenId: "landing", parentPath: [], componentRef: "Button", children: "Save" },
      },
    ]);
    expect(result.rolledBack).toBe(true);
    const failing = result.results.find((r) => !r.ok);
    expect(failing).toBeDefined();
    const error = failing?.error as Record<string, unknown>;
    expect(error.kind).toBe("BadRequest");
    expect(error.hint).toContain("props.children");
  });

  test("a valid batch add_node succeeds and carries no hint", async () => {
    const result = await runBatch(ctx, [
      {
        tool: "add_node",
        args: {
          screenId: "landing",
          parentPath: [],
          componentRef: "Card",
          children: [{ $ref: "Button", props: { children: "Save" } }],
        },
      },
    ]);
    expect(result.rolledBack).toBe(false);
    expect(result.completed).toBe(1);
  });
});

describe("shared add_node body", () => {
  /**
   * The scalar is accepted by the schema on purpose and rejected by
   * `normalizeAddNode` — every surface shares both, so the nudge reaches
   * agents identically through MCP, batch, and any future HTTP route rather
   * than depending on which one remembered to special-case it.
   */
  test("a scalar children is rejected by normalization, with the hint", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "landing",
      parentPath: [],
      componentRef: "Button",
      children: "Save",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normalized = normalizeAddNode(parsed.data);
    expect(normalized.ok).toBe(false);
    if (normalized.ok) return;
    const error = badRequest(normalized.message, normalized.issues);
    if (error.kind === "BadRequest") expect(error.hint).toContain("props.children");
  });

  test("a valid children array body passes validation and normalization", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "landing",
      parentPath: [],
      componentRef: "Card",
      children: [{ $ref: "Button" }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const normalized = normalizeAddNode(parsed.data);
    expect(normalized.ok).toBe(true);
  });

  test("the removed `propPatch` alias is rejected rather than silently dropped", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "landing",
      parentPath: [],
      componentRef: "Box",
      propPatch: { className: "p-4" },
    });
    // `props` is add_node's only name for this. Under the strict Body an
    // undeclared key fails loudly instead of vanishing mid-batch.
    expect(parsed.success).toBe(false);
  });

  test("an unrelated body failure carries no children hint", () => {
    const parsed = AddNodeBody.safeParse({
      screenId: "",
      parentPath: [],
      componentRef: "Button",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const error = badRequest("Request body failed validation.", parsed.error.issues);
    if (error.kind === "BadRequest") expect(error.hint).toBeUndefined();
  });
});
