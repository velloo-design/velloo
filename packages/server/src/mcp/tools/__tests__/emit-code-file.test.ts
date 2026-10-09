import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerEmitTools } from "../emit.ts";
import type { McpResult } from "../result.ts";

/**
 * `emit_code { file }` writes the page into the host app — the one place emit
 * touches a file that isn't the design's — so most of this is about where it
 * may write and what it refuses to write over.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let folder: TestContext | undefined;
afterEach(async () => {
  await folder?.cleanup();
  folder = undefined;
});

async function app(dependencies: Record<string, string> = { "lucide-react": "^0.400.0" }) {
  folder = await testContext({
    label: "emit-file",
    nested: true,
    screens: {
      reports: {
        id: "reports",
        name: "Reports",
        tree: {
          $ref: "Box",
          props: { className: "flex flex-col gap-4" },
          children: [
            { $ref: "Icon", props: { name: "trending-up" } },
            { $ref: "Button", props: { children: "Export" } },
          ],
        },
      },
    },
  });
  const root = join(folder.root, "..");
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies }));
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerEmitTools(mcp, folder.ctx, { provider: createShadcnProvider() } as never);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const emit = async (args: Record<string, unknown>) => {
    const result = await (tools.emit_code as { handler: ToolHandler }).handler(
      { screenId: "reports", ...args },
      {},
    );
    const [first] = result.content;
    return {
      isError: result.isError === true,
      blocks: result.content.length,
      body: JSON.parse(first?.type === "text" ? first.text : "{}") as Record<string, unknown>,
    };
  };
  return { root, emit, read: (rel: string) => readFile(join(root, rel), "utf8") };
}

describe("emit_code { file }", () => {
  test("writes the page as a module and returns where it went, not the code", async () => {
    const { emit, read } = await app();
    const { body, blocks, isError } = await emit({ file: "src/pages/reports.tsx" });
    expect(isError).toBe(false);
    // One block: the code is on disk, so none of it travels back.
    expect(blocks).toBe(1);
    expect(body).toMatchObject({
      screen: { id: "reports" },
      wrote: "src/pages/reports.tsx",
      component: "export default function Reports",
      imports: ["lucide-react", "@/components/ui/button"],
      componentsToInstall: ["button"],
      warnings: [],
    });
    expect(body.jsx).toBeUndefined();
    expect(body.classesUsed).toBeUndefined();
    const source = await read("src/pages/reports.tsx");
    expect(source).toContain('import { TrendingUp } from "lucide-react";');
    expect(source).toContain("export default function Reports() {");
    expect(source.split("\n").length - 1).toBe(body.lines as number);
  });

  test("an app without lucide-react gets the icons themselves, so the page builds as written", async () => {
    const { emit, read } = await app({});
    const { body } = await emit({ file: "src/reports.tsx" });
    expect(body.imports).toEqual(["@/components/ui/button"]);
    expect(body.icons).toContain("defined in the file");
    expect(body.warnings).toEqual([]);
    const source = await read("src/reports.tsx");
    expect(source).not.toContain("lucide-react");
    expect(source).toContain('import type { SVGProps } from "react";');
    expect(source).toContain(
      "function TrendingUp({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number | string }) {",
    );
    expect(source).toContain(
      'strokeLinejoin="round" width={size} height={size} aria-hidden="true" {...props}>',
    );
    expect(source).toContain('<path d="M16 7h6v6" />');
    // Used exactly as the import would have been, at the size the canvas drew it.
    expect(source).toContain("<TrendingUp size={16} />");
  });

  test("says when the page imports a package the app does not have", async () => {
    const { emit } = await app({ "lucide-react": "^0.400.0" });
    folder?.ctx.folder.screens.set("reports", {
      id: "reports",
      name: "Reports",
      tree: {
        $ref: "Chart",
        $repo: { importPath: "@acme/charts", exportName: "Chart" },
        props: {},
      },
    });
    const { body } = await emit({ file: "src/reports.jsx" });
    expect((body.warnings as string[])[0]).toContain("imports @acme/charts");
    expect((body.warnings as string[])[0]).toContain("install it");
  });

  test("leaves a file that is already there alone, unless told to replace it", async () => {
    const { root, emit, read } = await app();
    await mkdir(join(root, "src"), { recursive: true });
    const mine = "export function ReportsScreen() {\n  return <main>Mine</main>;\n}\n";
    await writeFile(join(root, "src/reports.tsx"), mine);
    const refused = await emit({ file: "src/reports.tsx" });
    expect(refused.isError).toBe(true);
    expect(refused.body.message).toContain('"src/reports.tsx" already exists (4 lines)');
    expect(refused.body.message).toContain("overwrite: true");
    expect(await read("src/reports.tsx")).toBe(mine);

    // Replacing it keeps the export the app already reaches it by.
    const replaced = await emit({ file: "src/reports.tsx", overwrite: true });
    expect(replaced.body).toMatchObject({
      replaced: true,
      component: "export function ReportsScreen",
    });
    expect(await read("src/reports.tsx")).toContain("export function ReportsScreen() {");
  });

  test("a placeholder that renders nothing is a place for the page, not a page", async () => {
    const { root, emit, read } = await app();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "src/target.jsx"),
      "// routed at /target\nexport default function Target() {\n  return null;\n}\n",
    );
    const { body, isError } = await emit({ file: "src/target.jsx" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ replaced: true, component: "export default function Target" });
    expect(await read("src/target.jsx")).toContain("<Button>Export</Button>");
  });

  test("writes its own file again as the design changes, until someone edits it", async () => {
    const { root, emit, read } = await app();
    expect((await emit({ file: "src/reports.tsx" })).isError).toBe(false);
    expect((await emit({ file: "src/reports.tsx" })).body).toMatchObject({ replaced: true });
    await writeFile(join(root, "src/reports.tsx"), `${await read("src/reports.tsx")}// wired\n`);
    expect((await emit({ file: "src/reports.tsx" })).isError).toBe(true);
  });

  test("a router's file name is not the component's: the screen names it", async () => {
    const { emit } = await app();
    const { body } = await emit({ file: "app/reports/page.tsx" });
    expect(body.component).toBe("export default function Reports");
  });

  test("takes the absolute path an agent's file tools use, symlinked temp directory and all", async () => {
    const { emit, read } = await app();
    // The scaffold's own spelling of the app root, before any symlink is resolved.
    const unresolved = join(folder?.root ?? "", "..", "src/absolute.tsx");
    const { body, isError } = await emit({ file: unresolved });
    expect(isError).toBe(false);
    expect(body.wrote).toBe("src/absolute.tsx");
    expect(await read("src/absolute.tsx")).toContain("export default function Absolute() {");
  });

  test("only a source file inside the app, outside the design and node_modules", async () => {
    const { root, emit } = await app();
    const outside = join(tmpdir(), `velloo-emit-outside-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(root, "linked"));
    for (const [file, reason] of [
      ["../escape.tsx", "inside the app"],
      [join(tmpdir(), "abs.tsx"), "inside the app"],
      ["node_modules/pkg/index.jsx", "node_modules"],
      [".github/page.tsx", "dot-directory"],
      ["velloo/screens/page.tsx", "design folder"],
      ["linked/page.tsx", "outside the app"],
      ["src/reports.json", "emits JSX"],
      ["src/reports.ts", "emits JSX"],
    ] as const) {
      const { isError, body } = await emit({ file, overwrite: true });
      expect(isError).toBe(true);
      expect(body.message).toContain(reason);
    }
  });

  test("a markup screen is written as a template, and only as one", async () => {
    const { emit, read } = await app();
    const html = createHtmlProvider();
    if (!folder) throw new Error("no folder");
    Object.assign(folder.ctx, { providers: { default: html }, defaultProvider: html });
    folder.ctx.folder.screens.set("reports", {
      id: "reports",
      name: "Reports",
      tree: {
        $ref: "Html",
        props: { as: "form", "hx-get": "/search" },
        children: [{ $ref: "Html", props: { as: "input", name: "q" } }],
      },
    });
    const refused = await emit({ file: "templates/reports.tsx" });
    expect(refused.isError).toBe(true);
    expect(refused.body.message).toContain("emits markup");
    const { body, isError } = await emit({ file: "templates/reports.html" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ wrote: "templates/reports.html" });
    expect(body.html).toBeUndefined();
    expect(await read("templates/reports.html")).toContain('<form hx-get="/search">');
  });

  test("without `file` nothing is written and the code comes back as before", async () => {
    const { emit } = await app();
    const { body, blocks } = await emit({});
    expect(blocks).toBe(2);
    expect(body.jsx).toBe("(the next block, as code)");
    expect(body.wrote).toBeUndefined();
  });
});
