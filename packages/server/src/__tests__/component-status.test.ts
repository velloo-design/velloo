import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FrameworkAdapter } from "@velloo/provider";
import { createProvider as createChakraProvider } from "@velloo/provider-chakra";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { createProvider as createUpstreamProvider } from "@velloo/provider-shadcn-upstream";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { DesignFolder } from "../design-folder.ts";
import type { CanvasBundler } from "../live/canvas-bundler.ts";
import { registerDiscoveryTools } from "../mcp/tools/discovery.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * `component_status` is the tool an agent is told to consult before claiming
 * the canvas renders an app component exactly, so its answers have to be
 * unambiguous. A production-like evaluation caught the gap this guards: a
 * model asked about the app's OWN component names (Panel, StatusChip, Manifest) and got the same
 * `unavailable` it would get for a broken library component, which reads as
 * "the canvas is broken" rather than "those are not library ids".
 */
async function fixture(
  provider: FrameworkAdapter = createShadcnProvider(),
  libraryId = "shadcn",
  canvasBundler?: CanvasBundler,
  extra: Record<string, unknown> = {},
) {
  const mcp = new McpServer({ name: "component-status-test", version: "0.0.0" });
  const folder = {
    root: "/tmp/nonexistent",
    config: { defaultLibrary: libraryId, libraries: {}, extensions: {} },
    snippets: new Map(),
  } as unknown as DesignFolder;
  const ctx = {
    folder,
    providers: { [libraryId]: provider },
    defaultProvider: provider,
    ...(canvasBundler ? { canvasBundler } : {}),
    broadcast: () => undefined,
    ...extra,
  } as unknown as MutationContext;
  registerDiscoveryTools(mcp, ctx);

  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(b), client.connect(a)]);
  return {
    async status(ids: string[]) {
      const res = await client.callTool({ name: "component_status", arguments: { ids } });
      const text = (res.content as { type: string; text: string }[])[0]?.text ?? "{}";
      return JSON.parse(text) as {
        renderable?: boolean;
        renderSource?: string;
        hostMount?: { supported: boolean; mounted?: boolean; note?: string };
        diagnostics: { id: string; status: string; note?: string; observed?: boolean }[];
        errors?: { message: string }[];
      };
    },
  };
}

describe("component_status", () => {
  test("reports an id outside the library as unknown, not unavailable", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Panel", "StatusChip", "Manifest"]);
    expect(diagnostics.map((d) => d.status)).toEqual(["unknown", "unknown", "unknown"]);
    // The note has to send the agent to the right place — the ids are wrong,
    // the canvas is not broken.
    expect(diagnostics[0]?.note).toContain("list_components");
  });

  test("a known component is not reported as unknown", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Button"]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.status).not.toBe("unknown");
  });

  test("known and unknown ids in one call are separated", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Button", "Panel"]);
    const byId = new Map(diagnostics.map((d) => [d.id, d.status]));
    expect(byId.get("Panel")).toBe("unknown");
    expect(byId.get("Button")).not.toBe("unknown");
  });

  test("an adapter with a browser bundle and no bundler says so, rather than claiming one", async () => {
    // The fixture has no canvas daemon, so nothing has established how these
    // components render.
    const bundled: FrameworkAdapter = {
      ...createShadcnProvider(),
      canvasBundleSpec: { components: () => [], styleRuntime: { kind: "none" } },
    };
    const { status } = await fixture(bundled, "shadcn");
    const { diagnostics } = await status(["Button"]);
    expect(diagnostics[0]?.status).toBe("unchecked");
    expect(diagnostics[0]?.note).toContain("has not been established");
  });

  test("an adapter with no browser bundle of its own renders on the server", async () => {
    const { status } = await fixture();
    const { diagnostics } = await status(["Button"]);
    expect(diagnostics[0]?.status).toBe("server-rendered");
  });

  test("a bundled Chakra adapter is renderable, and says it renders on the server", async () => {
    const { status } = await fixture(createChakraProvider(), "chakra");
    const result = await status(["Button", "Image"]);
    expect(result.renderable).toBe(true);
    expect(result.renderSource).toBe("bundled-library");
    // Not an adapter-wide "no host mounting": a screen with the app's own
    // components mounts those whatever this adapter declares.
    expect(result.hostMount?.supported).toBe(false);
    expect(result.hostMount?.note).toContain("still client-mounts those");
    // Asked by id, not about a screen: there is no screen to have mounted.
    expect(result.hostMount?.mounted).toBeUndefined();
    expect(result.diagnostics.map((entry) => entry.status)).toEqual([
      "server-rendered",
      "server-rendered",
    ]);
    expect(result.diagnostics[0]?.note).toContain("Chakra");
    // Per component, not per screen — so it says what happens on a screen
    // that also uses the app's own components, where it is a fallback.
    expect(result.diagnostics[0]?.note).toContain("inside that screen's client mount");
  });

  test("an HTML folder is never told a real library renders its components", async () => {
    const { status } = await fixture(createHtmlProvider(), "html");
    const result = await status(["Html", "Box", "Heading"]);
    expect(result.renderSource).toBe("velloo-primitives");
    for (const entry of result.diagnostics) {
      expect(entry.status).toBe("server-rendered");
      expect(entry.note).toContain("there is no component library behind it");
      expect(entry.note).not.toContain("real library");
    }
    // The design is styled by its own copies of the app's stylesheets, and how
    // fresh those are is the whole fidelity story for this folder.
    expect(result.diagnostics[0]?.note).toContain("store_host_files");
  });

  for (const [name, make] of [
    ["shadcn", () => createUpstreamProvider()],
    ["MUI", () => createMuiProvider()],
  ] as const) {
    test(`a ${name} folder makes no folder-wide library claim beside its per-component answers`, async () => {
      // A bundled adapter answers per component. A folder-wide
      // "bundled-library" next to "Rendered directly from the app's source
      // file" is two answers that contradict each other.
      const { status } = await fixture(make(), "ui");
      const result = await status(["Button"]);
      expect(result.renderSource).toBeUndefined();
      expect(result.hostMount).toBeUndefined();
      expect(result.diagnostics[0]?.status).toBe("unchecked");
    });
  }

  test("a build's exact verdict says it is only build-checked until a frame observes it", async () => {
    let runtime: { id: string; status: "exact" | "fallback"; note?: string }[] = [];
    const bundler = {
      build: async () => ({
        usable: true,
        errors: [],
        diagnostics: [
          { id: "Button", status: "exact", note: "Rendered directly from the app's source file." },
        ],
      }),
      runtimeForLibrary: () => runtime,
    } as unknown as CanvasBundler;
    const { status } = await fixture(createUpstreamProvider(), "ui", bundler);

    const built = await status(["Button"]);
    expect(built.renderSource).toBeUndefined();
    expect(built.diagnostics[0]).toMatchObject({ status: "exact", observed: false });
    expect(built.diagnostics[0]?.note).toContain("Build-checked only");

    runtime = [{ id: "Button", status: "fallback", note: "It threw when mounted." }];
    const seen = await status(["Button"]);
    expect(seen.diagnostics[0]).toMatchObject({ status: "fallback", observed: true });
  });

  test("a manifest that fails to load yields unchecked, never a confident source", async () => {
    const broken: FrameworkAdapter = {
      ...createHtmlProvider(),
      loadManifest: async () => {
        throw new Error("manifest missing");
      },
    };
    const { status } = await fixture(broken, "html");
    const result = await status(["Html"]);
    expect(result.renderSource).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ id: "Html", status: "unchecked", observed: false }),
    ]);
    expect(result.errors?.[0]?.message).toContain("manifest failed to load");
  });

  test("a failed manifest still lets the app's own components answer from the repo catalog", async () => {
    const broken: FrameworkAdapter = {
      ...createHtmlProvider(),
      loadManifest: async () => {
        throw new Error("manifest missing");
      },
    };
    const repo = {
      catalog: async () => ({ byId: new Map([["Panel", { key: "repo:app#Panel" }]]) }),
    };
    const { status } = await fixture(broken, "html", undefined, { repo });
    const byId = new Map((await status(["Panel", "Html"])).diagnostics.map((d) => [d.id, d]));
    expect(byId.get("Panel")?.note).toContain("the app's own components");
    expect(byId.get("Html")).toEqual(
      expect.objectContaining({ status: "unchecked", note: expect.stringContaining("manifest") }),
    );
  });
});
