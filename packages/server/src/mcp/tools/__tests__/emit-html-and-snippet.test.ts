import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import type { Screen, Snippet } from "@velloo/schema";
import {
  type TestContext,
  type TestContextOptions,
  testContext,
} from "../../../testing/design-folder.ts";
import { registerEmitTools } from "../emit.ts";
import type { McpResult } from "../result.ts";

/**
 * The emit tools on the two shapes `emit-code-host.test.ts` leaves out: a
 * server-rendered HTML design, whose IR is markup for the app's templates
 * rather than JSX, and a snippet, which is emitted as a component of its own.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

/** Call an emit tool on a design folder nested in an app holding `hostFiles`. */
async function emit(
  options: TestContextOptions,
  tool: string,
  args: Record<string, unknown>,
  hostFiles: Record<string, string> = {},
) {
  t = await testContext({ label: "emit-formats", nested: true, ...options });
  for (const [rel, contents] of Object.entries(hostFiles)) {
    await writeFile(join(t.root, "..", rel), contents);
  }
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerEmitTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const handler = tools[tool]?.handler;
  if (!handler) throw new Error(`${tool} was not registered`);
  const result = await handler(args, {});
  const [meta, code] = result.content.map((part) => (part.type === "text" ? part.text : ""));
  return {
    isError: result.isError === true,
    meta: JSON.parse(meta ?? "{}") as Record<string, unknown>,
    code,
    structured: result.structuredContent,
  };
}

const html = (as: string, props: Record<string, unknown> = {}, children?: Screen["tree"][]) => ({
  $ref: "Html",
  props: { as, ...props },
  ...(children ? { children } : {}),
});

const FIELD: Snippet = {
  id: "field",
  name: "Field",
  params: [{ name: "label", type: "string" }],
  tree: html("label", {}, [
    html("span", { children: { $param: "label" } }),
    html("input", { name: "email" }),
  ]),
};

const HTML_FOLDER: TestContextOptions = {
  provider: createHtmlProvider(),
  config: { library: { id: "html" }, styling: { framework: "none" } },
  screens: {
    login: {
      id: "login",
      name: "Login",
      tree: html("form", { "hx-post": "/login", className: "stack" }, [
        { $snippet: "field", args: { label: "Email" } },
        html("button", { type: "submit", children: "Sign in" }),
      ]),
    },
  },
  snippets: { field: FIELD },
};

describe("emit on a server-rendered HTML design", () => {
  test("emit_code returns native markup with its hx-* attributes, and the routes the app must serve", async () => {
    const { isError, meta, code, structured } = await emit(HTML_FOLDER, "emit_code", {
      screenId: "login",
    });
    expect(isError).toBe(false);
    expect(meta).toMatchObject({
      format: "html",
      html: "(the next block, as code)",
      hostRoutes: ["/login"],
    });
    // A template's markup: `class`, not `className`, and the snippet written out in place.
    expect(code).toBe(
      '<form hx-post="/login" class="stack"><label><span>Email</span><input name="email" /></label><button type="submit">Sign in</button></form>',
    );
    expect(structured?.html).toBe(code);
    expect(meta.jsx).toBeUndefined();
    expect(JSON.stringify(meta.warnings)).toContain("Velloo does not generate handlers");
    // The flat class list is the same opt-in it is for JSX.
    expect(meta.classesUsed).toBeUndefined();
  });

  test("emit_code lists the classes when asked, for the stylesheet the app has to hold them", async () => {
    const { meta } = await emit(HTML_FOLDER, "emit_code", { screenId: "login", classesUsed: true });
    expect(meta.classesUsed).toEqual(["stack"]);
  });

  test("emit_snippet returns a partial with a $name marker for each param", async () => {
    const { isError, meta, code } = await emit(HTML_FOLDER, "emit_snippet", {
      snippetId: "field",
    });
    expect(isError).toBe(false);
    expect(meta).toMatchObject({
      format: "html",
      id: "field",
      params: [{ name: "label", type: "string" }],
    });
    expect(code).toBe('<label><span>$label</span><input name="email" /></label>');
    expect(JSON.stringify(meta.warnings)).toContain("Replace each $name marker");
  });
});

describe("emit_snippet on a Tailwind design", () => {
  const CARD: Snippet = {
    id: "stat-card",
    name: "Stat Card",
    params: [
      { name: "label", type: "string" },
      { name: "hint", type: "string", optional: true },
    ],
    tree: {
      $ref: "Box",
      props: { className: "flex flex-col gap-1 shadow-xs" },
      children: [{ $ref: "Text", props: { children: { $param: "label" } } }],
    },
  };

  test("is a component: a PascalCase name, its typed params, and a body that reads them", async () => {
    const { meta, code } = await emit({ snippets: { "stat-card": CARD } }, "emit_snippet", {
      snippetId: "stat-card",
    });
    expect(meta).toMatchObject({
      id: "stat-card",
      componentName: "StatCard",
      params: CARD.params,
      jsx: "(the next block, as code)",
    });
    expect(code).toContain('<div className="flex flex-col gap-1 shadow-xs">');
    expect(code).toContain("{label}</p>");
  });

  test("is checked against the app it will be written into, like a screen is", async () => {
    // A snippet's classes are in no screen's IR, so the advisory has to come
    // from the snippet's own JSX or a Tailwind v3 app is never told.
    const { meta } = await emit(
      { snippets: { "stat-card": CARD } },
      "emit_snippet",
      { snippetId: "stat-card" },
      { "package.json": JSON.stringify({ devDependencies: { tailwindcss: "^3.4.15" } }) },
    );
    const ir = meta as { warnings: string[]; tailwindV3Compat?: { class: string }[] };
    expect(ir.tailwindV3Compat?.map((issue) => issue.class)).toContain("shadow-xs");
    expect(ir.warnings.find((warning) => warning.includes("typeset"))).toContain("`text-body`");
  });

  test("a snippet that does not exist is a SnippetNotFound naming it", async () => {
    const { isError, meta } = await emit({}, "emit_snippet", { snippetId: "nope" });
    expect(isError).toBe(true);
    expect(meta).toEqual({ kind: "SnippetNotFound", snippetId: "nope" });
  });
});
