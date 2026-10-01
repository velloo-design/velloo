import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerEmitTools } from "../emit.ts";
import type { McpResult } from "../result.ts";

/**
 * `emit_code` against the host app it is written into: the Heading/Text
 * helpers lower to typeset utilities (`text-body`, `tracking-h1`) that exist
 * only once `emit_theme` ran in that app, so an app without them is told — the
 * class would otherwise compile to nothing, with no error anywhere.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let folder: TestContext | undefined;
afterEach(async () => {
  await folder?.cleanup();
  folder = undefined;
});

async function emitFor(tailwind: string, hostFiles: Record<string, string> = {}) {
  folder = await testContext({
    label: "emit-host",
    nested: true,
    screens: {
      home: {
        id: "home",
        name: "Home",
        tree: {
          $ref: "Box",
          props: { className: "flex flex-col gap-4 shadow-xs" },
          children: [
            { $ref: "Heading", props: { level: 1, children: "Queue" } },
            { $ref: "Text", props: { children: "Jobs waiting." } },
          ],
        },
      },
    },
    // The design folder's own stylesheet must not count as the app's.
    files: { "theme/canvas.css": "@theme { --text-body: 1rem; --tracking-h1: 0; }" },
  });
  const appRoot = join(folder.root, "..");
  await writeFile(
    join(appRoot, "package.json"),
    JSON.stringify({ devDependencies: { tailwindcss: tailwind } }),
  );
  for (const [rel, contents] of Object.entries(hostFiles)) {
    await writeFile(join(appRoot, rel), contents);
  }
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerEmitTools(mcp, folder.ctx, { provider: createShadcnProvider() } as never);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const r = await (tools.emit_code as { handler: ToolHandler }).handler({ screenId: "home" }, {});
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  return JSON.parse(text) as {
    jsx: string;
    warnings: string[];
    tailwindV3Compat?: { class: string }[];
  };
}

describe("emit_code — typeset utilities the host app lacks", () => {
  test("a Tailwind v3 app without the velloo preset is warned, next to its v3 renames", async () => {
    const ir = await emitFor("^3.4.15");
    expect(ir.jsx).toContain("tracking-h1");
    const warning = ir.warnings.find((w) => w.includes("typeset"));
    expect(warning).toBeDefined();
    expect(warning).toContain("`tracking-h1`");
    expect(warning).toContain("`text-body`");
    expect(warning).toContain("emit_theme");
    expect(ir.tailwindV3Compat?.map((i) => i.class)).toContain("shadow-xs");
  });

  test("a Tailwind v4 app whose @theme declares the typeset tokens is not", async () => {
    const tokens = ["h1", "body"]
      .flatMap((r) => [`--text-${r}: 1rem;`, `--leading-${r}: 1.5;`, `--tracking-${r}: 0;`])
      .join(" ");
    const ir = await emitFor("^4.1.0", {
      "globals.css": `@import "tailwindcss";\n@theme { ${tokens} }\n`,
    });
    expect(ir.warnings.some((w) => w.includes("typeset"))).toBe(false);
    expect(ir.tailwindV3Compat).toBeUndefined();
  });
});
