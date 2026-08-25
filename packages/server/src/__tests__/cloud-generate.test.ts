import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { Server } from "bun";
import { formatDollars, generateAsset, svgLooksActive } from "../cloud-generate.ts";
import { loadDesignFolder } from "../design-folder.ts";
import { registerGenerateTools } from "../mcp/tools/generate.ts";
import type { MutationContext } from "../mutations/index.ts";

/**
 * Hosted asset generation against an in-process stub cloud. Covers
 * the success path (asset stored like `upload_asset` would, cost surfaced),
 * every documented failure status mapping to a clear agent-facing message,
 * and the logged-out / unreachable no-network paths.
 */

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';

let tmp: string;
let server: Server<undefined>;
let base: string;
let stub: {
  status: number;
  body: unknown;
  requests: Array<{ auth: string | null; body: unknown }>;
};

const config = {
  schemaVersion: 1,
  toolVersion: "test",
  library: { id: "shadcn-react", version: "test", source: "binary", componentsPath: "binary" },
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

function imageSuccess(id = "gen_ab12cd34") {
  return {
    id,
    kind: "image",
    dataUrl: `data:image/png;base64,${PNG_1PX.toString("base64")}`,
    chargedMicros: 250_000,
    balanceMicros: 11_750_000,
  };
}

function svgSuccess(id = "gen_ef56ab78") {
  return {
    id,
    kind: "svg",
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(SVG_MARKUP).toString("base64")}`,
    chargedMicros: 50_000,
    balanceMicros: 950_000,
  };
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-generate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeFile(join(tmp, ".design", "config.json"), JSON.stringify(config));
  await writeFile(join(tmp, "theme", "default.json"), JSON.stringify(theme));
  await writeFile(
    join(tmp, "screens", "home.json"),
    JSON.stringify({ id: "home", name: "Home", tree: { $ref: "Box" } }),
  );

  stub = { status: 200, body: imageSuccess(), requests: [] };
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/v1/assets/generate") {
        stub.requests.push({
          auth: req.headers.get("authorization"),
          body: await req.json(),
        });
        return Response.json(stub.body, { status: stub.status });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
});

afterEach(async () => {
  server.stop(true);
  await rm(tmp, { recursive: true, force: true });
});

const cloud = () => ({ url: base, token: "vlk_test" });

test("formatDollars renders micros as dollars", () => {
  expect(formatDollars(250_000)).toBe("$0.25");
  expect(formatDollars(11_750_000)).toBe("$11.75");
  expect(formatDollars(50_000)).toBe("$0.05");
  expect(formatDollars(0)).toBe("$0.00");
});

test("logged out never touches the network and points at `velloo login`", async () => {
  const r = await generateAsset(tmp, { url: base }, { prompt: "a cloud", kind: "image" });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe("LoggedOut");
    expect(r.error.message).toContain("velloo login");
    expect(r.error.message).toContain("upload_asset");
  }
  expect(stub.requests.length).toBe(0);
});

test("an unreachable cloud reports the failure without charging language ambiguity", async () => {
  const r = await generateAsset(
    tmp,
    { url: "http://127.0.0.1:1", token: "vlk_test" },
    { prompt: "a cloud", kind: "image" },
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe("Unreachable");
    expect(r.error.message).toContain("velloo-cloud");
  }
});

describe("success", () => {
  test("image: stores the decoded PNG in assets/ (upload_asset naming) and reports cost", async () => {
    const r = await generateAsset(tmp, cloud(), {
      prompt: "hero art",
      kind: "image",
      size: "1536x1024",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/gen_ab12cd34.png");
    expect(r.value.url).toBe("/assets/gen_ab12cd34.png");
    expect(r.value.cost).toBe("cost $0.25, balance $11.75");
    expect(r.value.chargedMicros).toBe(250_000);
    expect(r.value.balanceMicros).toBe(11_750_000);
    expect(r.value.content).toBeUndefined();
    const onDisk = await readFile(join(tmp, "assets", "gen_ab12cd34.png"));
    expect(onDisk.equals(PNG_1PX)).toBe(true);
    // The request carried auth + the size passthrough.
    expect(stub.requests[0]?.auth).toBe("Bearer vlk_test");
    expect(stub.requests[0]?.body).toEqual({
      prompt: "hero art",
      kind: "image",
      size: "1536x1024",
    });
  });

  test("svg: stores the markup and returns it inline for <SVG content>", async () => {
    stub.body = svgSuccess();
    const r = await generateAsset(tmp, cloud(), { prompt: "a mark", kind: "svg" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/gen_ef56ab78.svg");
    expect(r.value.content).toBe(SVG_MARKUP);
    expect(r.value.cost).toBe("cost $0.05, balance $0.95");
    expect(await readFile(join(tmp, "assets", "gen_ef56ab78.svg"), "utf8")).toBe(SVG_MARKUP);
  });

  test("filename stem overrides the id and is sanitized; size never sent for svg", async () => {
    stub.body = svgSuccess();
    const r = await generateAsset(tmp, cloud(), {
      prompt: "a mark",
      kind: "svg",
      filename: "../evil/brand mark.svg",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/brand_mark.svg");
    expect(stub.requests[0]?.body).toEqual({ prompt: "a mark", kind: "svg" });
  });

  test("model passes through for images, never for svg", async () => {
    const r = await generateAsset(tmp, cloud(), {
      prompt: "hero art",
      kind: "image",
      model: "flux-schnell",
    });
    expect(r.ok).toBe(true);
    expect(stub.requests[0]?.body).toEqual({
      prompt: "hero art",
      kind: "image",
      model: "flux-schnell",
    });

    stub.body = svgSuccess();
    await generateAsset(tmp, cloud(), { prompt: "a mark", kind: "svg", model: "flux-schnell" });
    expect(stub.requests[1]?.body).toEqual({ prompt: "a mark", kind: "svg" });
  });
});

describe("failure statuses map to actionable messages", () => {
  const reject = (status: number, error: string, message: string) => {
    stub.status = status;
    stub.body = { error, message };
  };

  const generate = async () => {
    const r = await generateAsset(tmp, cloud(), { prompt: "x", kind: "image" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.kind).toBe("CloudRejected");
    return r.error;
  };

  test("401 passes the message through and says how to re-auth", async () => {
    reject(401, "unauthorized", "Invalid or expired token.");
    const e = await generate();
    expect(e.status).toBe(401);
    expect(e.message).toContain("Invalid or expired token.");
    expect(e.message).toContain("velloo login");
  });

  test("400 passes the cloud's validation message through", async () => {
    reject(400, "bad_request", "prompt must be 1..2000 characters");
    const e = await generate();
    expect(e.message).toContain("prompt must be 1..2000 characters");
  });

  test("400 for an unknown model relays the server's allowlist verbatim", async () => {
    reject(
      400,
      "bad_request",
      'Unknown image model "dall-e-9". Allowed models: gpt-image-1, flux-schnell.',
    );
    const r = await generateAsset(tmp, cloud(), {
      prompt: "x",
      kind: "image",
      model: "dall-e-9",
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.status).toBe(400);
    expect(r.error.message).toContain("Allowed models: gpt-image-1, flux-schnell.");
  });

  test("402 keeps the cloud's price/balance/top-up text and adds the way out", async () => {
    reject(
      402,
      "insufficient_credits",
      "Insufficient credits: image generation costs $0.25, balance $0.10. Top up at https://velloo.design/account.",
    );
    const e = await generate();
    expect(e.status).toBe(402);
    expect(e.message).toContain("Top up at https://velloo.design/account");
    expect(e.message).toContain("top up credits");
  });

  test("404 (feature off) names the local alternative", async () => {
    reject(404, "not_found", "Asset generation is not enabled on this server.");
    const e = await generate();
    expect(e.message).toContain("not enabled");
    expect(e.message).toContain("upload_asset");
  });

  test("429 says to wait and retry", async () => {
    reject(429, "rate_limited", "Rate limit exceeded: 10 generations per minute per account.");
    const e = await generate();
    expect(e.message).toContain("10 generations per minute");
    expect(e.message).toContain("wait a minute");
  });

  test("502 generation_failed relays that no credits were charged", async () => {
    reject(502, "generation_failed", "The provider failed to generate; no credits were charged.");
    const e = await generate();
    expect(e.message).toContain("no credits were charged");
    expect(e.message).toContain("retry once");
  });

  test("503 (provider unconfigured) names the local alternative", async () => {
    reject(503, "unavailable", "No generation provider is configured.");
    const e = await generate();
    expect(e.message).toContain("No generation provider is configured.");
    expect(e.message).toContain("upload_asset");
  });

  test("a body without a message still yields a readable error", async () => {
    stub.status = 500;
    stub.body = "gateway soup";
    const e = await generate();
    expect(e.message).toContain("500");
  });
});

test("a malformed dataUrl is rejected without writing anything", async () => {
  stub.body = { ...imageSuccess(), dataUrl: "data:image/webp;base64,AAAA" };
  const r = await generateAsset(tmp, cloud(), { prompt: "x", kind: "image" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("BadResponse");
});

describe("active-SVG defense in depth", () => {
  test("svgLooksActive flags scripts, handlers, foreignObject, javascript: URLs", () => {
    expect(svgLooksActive("<svg><script>alert(1)</script></svg>")).toBe(true);
    expect(svgLooksActive('<svg onload="alert(1)"><rect/></svg>')).toBe(true);
    expect(svgLooksActive("<svg><foreignObject><body/></foreignObject></svg>")).toBe(true);
    expect(svgLooksActive('<svg><a href="javascript:alert(1)"><rect/></a></svg>')).toBe(true);
    expect(svgLooksActive('<svg><a href=" javascript:alert(1)"><rect/></a></svg>')).toBe(true);
    expect(svgLooksActive(SVG_MARKUP)).toBe(false);
    expect(svgLooksActive('<svg><path d="M0 0h24v24H0z" stroke="none"/></svg>')).toBe(false);
    expect(svgLooksActive('<svg><a href="#anchor"><text>only once</text></a></svg>')).toBe(false);
  });

  test("generated SVG that still carries a script is refused, nothing written", async () => {
    const active = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    stub.body = {
      ...svgSuccess(),
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(active).toString("base64")}`,
    };
    const r = await generateAsset(tmp, cloud(), { prompt: "a mark", kind: "svg" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("BadResponse");
      expect(r.error.message).toContain("refusing");
    }
    expect(await readFile(join(tmp, "assets", "gen_ef56ab78.svg")).catch(() => null)).toBeNull();
  });
});

describe("the generate_asset tool", () => {
  async function connectTool(token?: string) {
    const provider = createShadcnProvider();
    const folder = await loadDesignFolder(tmp);
    const ctx: MutationContext = {
      folder,
      providers: { "shadcn-react": provider },
      defaultProvider: provider,
      broadcast: () => {},
    };
    const mcp = new McpServer({ name: "velloo", version: "0.1.0" });
    registerGenerateTools(mcp, ctx, { url: base, ...(token ? { token } : {}) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
    return client;
  }

  test("success result text carries the asset ref and the cost line", async () => {
    const client = await connectTool("vlk_test");
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "hero art", kind: "image" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("assets/gen_ab12cd34.png");
    expect(text).toContain("cost $0.25, balance $11.75");
    await client.close();
  });

  test("logged out surfaces as an isError result naming `velloo login`", async () => {
    const client = await connectTool();
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "hero art", kind: "image" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBe(true);
    expect(text).toContain("velloo login");
    await client.close();
  });

  test("a rejected model surfaces the server's allowlist in the tool text", async () => {
    stub.status = 400;
    stub.body = {
      error: "bad_request",
      message: 'Unknown image model "dall-e-9". Allowed models: gpt-image-1, flux-schnell.',
    };
    const client = await connectTool("vlk_test");
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "hero art", kind: "image", model: "dall-e-9" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBe(true);
    expect(text).toContain("Allowed models: gpt-image-1, flux-schnell.");
    // The model the agent asked for reached the wire.
    expect(stub.requests[0]?.body).toEqual({
      prompt: "hero art",
      kind: "image",
      model: "dall-e-9",
    });
    await client.close();
  });
});
