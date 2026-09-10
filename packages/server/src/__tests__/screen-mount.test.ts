import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CanvasBundleSpec } from "@velloo/provider";
import type { Node, Screen } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { registerDiscoveryTools } from "../mcp/tools/discovery.ts";
import { mountDiagnostics, screenMount } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * The browser mount is all-or-nothing: one component with no source that
 * compiles keeps the whole screen on the server render. `component_status`
 * asked about one id says `exact` regardless, so a screen-level answer — and a
 * warning on the captures that are actually of the server render — is what
 * stops an agent trusting a fidelity no capture shows.
 */

let app: string;

beforeAll(async () => {
  app = await mkdtemp(join(tmpdir(), "velloo-mount-"));
  const reactHost = resolve(import.meta.dir, "../../../provider-mui");
  for (const name of ["react", "react-dom"]) {
    const at = join(app, "node_modules", name);
    await mkdir(dirname(at), { recursive: true });
    await symlink(dirname(Bun.resolveSync(`${name}/package.json`, reactHost)), at, "dir");
  }
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "mount-app" }));
  await mkdir(join(app, "src"), { recursive: true });
  await writeFile(
    join(app, "src/ui.tsx"),
    "export function Box(p: { children?: unknown }) { return <div>{p.children as never}</div>; }\n" +
      "export function Button() { return <button type='button' />; }\n",
  );
  await writeFile(
    join(app, "src/broken.tsx"),
    'import { nope } from "no-such-package-xyz";\nexport function Broken() { return <div>{nope}</div>; }\n',
  );
});

afterAll(async () => {
  await rm(app, { recursive: true, force: true });
});

function fixture(tree: Node) {
  const spec: CanvasBundleSpec = {
    components: (ids) =>
      ids.map((id) => ({
        id,
        sources: [
          {
            importPath: join(app, "src", id === "Broken" ? "broken.tsx" : "ui.tsx"),
            exportName: id,
            fidelity: "exact",
            preflight: true,
          },
        ],
      })),
    styleRuntime: { kind: "none" },
  };
  const provider = {
    id: "app",
    loadManifest: async () => [{ id: "Box" }, { id: "Button" }, { id: "Broken" }],
    canvasBundleSpec: spec,
  };
  const screen = { id: "home", tree } as unknown as Screen;
  // The folder sits inside the app, so the app is its host root.
  const canvasBundler = new CanvasBundler(
    join(app, "design"),
    () => undefined,
    () => spec,
  );
  const folder = {
    root: join(app, "design"),
    config: { defaultLibrary: "app", libraries: { app: {} }, extensions: {} },
    snippets: new Map(),
    screens: new Map([["home", screen]]),
  } as unknown as DesignFolder;
  const ctx = {
    folder,
    providers: { app: provider },
    defaultProvider: provider,
    canvasBundler,
    broadcast: () => undefined,
  } as unknown as MutationContext;
  return { ctx, canvasBundler, screen };
}

async function componentStatus(ctx: MutationContext, args: Record<string, unknown>) {
  const mcp = new McpServer({ name: "screen-mount-test", version: "0.0.0" });
  registerDiscoveryTools(mcp, ctx);
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(b), client.connect(a)]);
  const res = await client.callTool({ name: "component_status", arguments: args });
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

const withBroken: Node = { $ref: "Box", children: [{ $ref: "Button" }, { $ref: "Broken" }] };
const clean: Node = { $ref: "Box", children: [{ $ref: "Button" }] };

describe("screen mount", () => {
  test("one uncompilable component keeps the whole screen on the server render", async () => {
    const { ctx, canvasBundler, screen } = fixture(withBroken);
    const mount = await screenMount(ctx, canvasBundler, screen);
    expect(mount.kind).toBe("server");
    if (mount.kind !== "server") return;
    expect(mount.reason).toContain("Broken");

    const [diagnostic, ...rest] = await mountDiagnostics(ctx, canvasBundler, screen);
    expect(rest).toEqual([]);
    expect(diagnostic?.code).toBe("render/server-fallback");
    expect(diagnostic?.message).toContain("no-such-package-xyz");
    expect(diagnostic?.message).toContain("including ones component_status reports as exact");
  }, 30_000);

  test("component_status { screen } reports the mount; { ids } alone cannot", async () => {
    const { ctx } = fixture(withBroken);
    const byIds = await componentStatus(ctx, { ids: ["Button"] });
    expect(byIds.usable).toBe(true);

    const byScreen = await componentStatus(ctx, { screen: "home" });
    expect(byScreen.mounted).toBe(false);
    expect(byScreen.note).toContain("Broken");
    expect(byScreen.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Button", status: "exact" }),
        expect.objectContaining({ id: "Broken", status: "unavailable" }),
      ]),
    );
  }, 30_000);

  test("a screen whose components all compile mounts, and captures carry no warning", async () => {
    const { ctx, canvasBundler, screen } = fixture(clean);
    expect((await screenMount(ctx, canvasBundler, screen)).kind).toBe("mounted");
    expect(await mountDiagnostics(ctx, canvasBundler, screen)).toEqual([]);
    const status = await componentStatus(ctx, { screen: "home" });
    expect(status.mounted).toBe(true);
    expect(status.note).toBeUndefined();
  }, 30_000);

  test("component_status needs a screen or ids", async () => {
    const { ctx } = fixture(clean);
    const res = await componentStatus(ctx, {});
    expect(res.kind).toBe("BadRequest");
  });
});
