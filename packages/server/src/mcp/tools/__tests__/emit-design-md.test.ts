import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { testContext } from "../../../testing/design-folder.ts";
import { importThemeDesignMd } from "../../../theme/index.ts";
import { registerEmitTools } from "../emit.ts";
import type { McpResult } from "../result.ts";

/**
 * `emit_theme { format: "design-md" }` — the tool layer, not the emitter.
 * What matters here is which files come back, what the notes say, and that a
 * folder's guidance reaches the output instead of being regenerated.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let folder: Awaited<ReturnType<typeof testContext>>;
let out: string;

const DESIGN_MD = `---
name: Paws
colors:
  background: "#f9f9ff"
  on-background: "#151c27"
  primary: "#855300"
  on-primary: "#ffffff"
---

## Brand & Style

Optimistic, trustworthy, active.
`;

async function call(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerEmitTools(mcp, folder.ctx, { provider: createShadcnProvider() } as never);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const tool = tools.emit_theme;
  if (!tool) throw new Error("emit_theme not registered");
  const r = await tool.handler(args, {});
  return JSON.parse(r.content[0]?.type === "text" ? r.content[0].text : "{}");
}

beforeEach(async () => {
  folder = await testContext({
    label: "emit-designmd",
    nested: true,
    config: { name: "Acme Web" },
  });
  out = await mkdtemp(join(tmpdir(), "velloo-emit-designmd-"));
});
afterEach(async () => {
  await folder.cleanup();
  await rm(out, { recursive: true, force: true });
});

describe('emit_theme { format: "design-md" }', () => {
  test("writes one file for a light-only theme", async () => {
    const r = (await call({ outputDir: out, format: "design-md", apply: true })) as {
      files: { path: string; applied: boolean }[];
      notes: string[];
    };
    expect(r.files).toHaveLength(1);
    expect(r.files[0]?.path.endsWith("DESIGN.md")).toBe(true);
    expect(await readFile(r.files[0]?.path as string, "utf8")).toContain("version: alpha");
    expect(r.notes.join(" ")).toContain("one file carries all of it");
  });

  test("names the file after the design, not the named-theme key", async () => {
    const r = (await call({ outputDir: out, format: "design-md", apply: true })) as {
      files: { path: string }[];
    };
    const body = await readFile(r.files[0]?.path as string, "utf8");
    expect(body).toContain("name: Acme Web");
    expect(body).not.toContain("name: default");
  });

  test("a dark palette makes it two files, and the notes say why", async () => {
    await importThemeDesignMd(folder.ctx, DESIGN_MD, { apply: true, mode: "dark" });
    const r = (await call({ outputDir: out, format: "design-md", apply: true })) as {
      files: { path: string }[];
      notes: string[];
    };
    expect(r.files.map((f) => f.path.split("/").pop())).toEqual(["DESIGN.md", "DESIGN.dark.md"]);
    expect(r.notes.join(" ")).toContain("no light/dark axis");
  });

  test("the design system document becomes the prose, read live", async () => {
    await writeFile(
      join(folder.root, "..", "DESIGN.md"),
      "# D\n\n## Overview\n\nQuiet and precise.\n\n## Colors\n\nOne accent.\n",
      "utf8",
    );
    const r = (await call({ outputDir: out, format: "design-md", apply: true })) as {
      files: { path: string }[];
      notes: string[];
    };
    const body = await readFile(r.files[0]?.path as string, "utf8");
    expect(body).toContain("Quiet and precise.");
    expect(r.notes.join(" ")).toContain("read from the design system document");
  });

  test("never writes over the document the design follows", async () => {
    const repo = join(folder.root, "..");
    const authored = "# D\n\n## Overview\n\nHand written.\n\n## Colors\n\nOne accent.\n";
    await writeFile(join(repo, "DESIGN.md"), authored, "utf8");
    const r = (await call({ outputDir: repo, format: "design-md", apply: true })) as {
      files: { applied: boolean }[];
      warnings: string[];
    };
    expect(r.files[0]?.applied).toBe(false);
    expect(r.warnings.join(" ")).toContain("never writes it");
    expect(await readFile(join(repo, "DESIGN.md"), "utf8")).toBe(authored);
  });

  test("without guidance it says the prose is generated rather than pretending", async () => {
    const r = (await call({ outputDir: out, format: "design-md", apply: true })) as {
      notes: string[];
    };
    expect(r.notes.join(" ")).toContain("generated from the tokens");
  });

  test("dry run by default — diffs, no files", async () => {
    const r = (await call({ outputDir: out, format: "design-md" })) as {
      files: { applied: boolean; contents: string }[];
    };
    expect(r.files[0]?.applied).toBe(false);
    expect(r.files[0]?.contents).toContain("version: alpha");
    await expect(readFile(join(out, "DESIGN.md"), "utf8")).rejects.toThrow();
  });

  test("the default format still emits the framework artifacts", async () => {
    const r = (await call({ outputDir: out })) as { files: { path: string }[] };
    expect(r.files.some((f) => f.path.endsWith("DESIGN.md"))).toBe(false);
    expect(r.files.some((f) => f.path.endsWith("globals.css"))).toBe(true);
  });
});
