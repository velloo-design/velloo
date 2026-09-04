import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { Server } from "bun";
import {
  describeGenerateFailure,
  formatDollars,
  generateAsset,
  svgLooksActive,
} from "../cloud-generate.ts";
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
  schemaVersion: 3,
  toolVersion: "test",
  libraries: {
    default: { id: "shadcn-upstream", version: "test", source: "binary", componentsPath: "binary" },
  },
  defaultLibrary: "default",
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

const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX.toString("base64")}`;
const SVG_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(SVG_MARKUP).toString("base64")}`;

function imageSuccess(id = "gen_ab12cd34", count = 1, dataUrl = PNG_DATA_URL) {
  return {
    id,
    intent: "photo",
    model: "provider:model@1",
    aspect: "16:9",
    count,
    assets: Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      kind: "image",
      mime: "image/png",
      bytes: PNG_1PX.length,
      dataUrl,
    })),
    chargedMicros: 40_000 * count,
    balanceMicros: 11_750_000,
    // legacy mirror the cloud still sends
    kind: "image",
    dataUrl: PNG_DATA_URL,
  };
}

function svgSuccess(id = "gen_ef56ab78", dataUrl = SVG_DATA_URL) {
  return {
    id,
    intent: "mark",
    model: "",
    aspect: "1:1",
    count: 1,
    assets: [{ index: 1, kind: "svg", mime: "image/svg+xml", bytes: 1, dataUrl }],
    chargedMicros: 50_000,
    balanceMicros: 950_000,
    kind: "svg",
    dataUrl: SVG_DATA_URL,
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
  const r = await generateAsset(tmp, { url: base }, { prompt: "a cloud", intent: "photo" });
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe("LoggedOut");
    expect(describeGenerateFailure(r.error)).toContain("velloo login");
    // Error messages name the way forward on THIS path; they don't advertise
    // authoring the art by hand as a consolation.
    expect(describeGenerateFailure(r.error)).not.toContain("upload_asset");
  }
  expect(stub.requests.length).toBe(0);
});

test("an unreachable cloud reports the failure without charging language ambiguity", async () => {
  const r = await generateAsset(
    tmp,
    { url: "http://127.0.0.1:1", token: "vlk_test" },
    { prompt: "a cloud", intent: "photo" },
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe("Unreachable");
    expect(describeGenerateFailure(r.error)).toContain("Nothing was generated or charged");
  }
});

test("a token that appears mid-session is picked up without a restart", async () => {
  // The daemon snapshots the credential at boot; `resolveToken` re-reads it, so
  // signing in after hitting the paywall works on the very next call.
  let signedIn = false;
  const live = { url: base, resolveToken: async () => (signedIn ? "vlk_fresh" : undefined) };

  const loggedOut = await generateAsset(tmp, live, { prompt: "x", intent: "photo" });
  expect(loggedOut.ok).toBe(false);
  if (!loggedOut.ok) expect(loggedOut.error.kind).toBe("LoggedOut");
  expect(stub.requests.length).toBe(0);

  signedIn = true;
  const after = await generateAsset(tmp, live, { prompt: "x", intent: "photo" });
  expect(after.ok).toBe(true);
  expect(stub.requests[0]?.auth).toBe("Bearer vlk_fresh");
});

test("a resolveToken that throws falls back to the boot-time token", async () => {
  const flaky = {
    url: base,
    token: "vlk_boot",
    resolveToken: async () => {
      throw new Error("credentials file mid-write");
    },
  };
  const r = await generateAsset(tmp, flaky, { prompt: "x", intent: "photo" });
  expect(r.ok).toBe(true);
  expect(stub.requests[0]?.auth).toBe("Bearer vlk_boot");
});

describe("success", () => {
  test("image: stores the decoded PNG in assets/ (upload_asset naming) and reports cost", async () => {
    const r = await generateAsset(tmp, cloud(), {
      prompt: "hero art",
      intent: "photo",
      aspect: "3:2",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/gen_ab12cd34.png");
    expect(r.value.url).toBe("/assets/gen_ab12cd34.png");
    expect(r.value.assets.length).toBe(1);
    expect(r.value.assets[0]?.url).toBe("/assets/gen_ab12cd34.png");
    expect(r.value.intent).toBe("photo");
    // The stub cloud still sends `model` (an older cloud would). It must not
    // reach the agent: which checkpoint serves an intent is the cloud's to
    // change, so the intent is the only name that crosses this boundary.
    expect((r.value as { model?: string }).model).toBeUndefined();
    expect(r.value.cost).toBe("cost $0.04, balance $11.75");
    expect(r.value.chargedMicros).toBe(40_000);
    expect(r.value.balanceMicros).toBe(11_750_000);
    expect(r.value.content).toBeUndefined();
    const onDisk = await readFile(join(tmp, "assets", "gen_ab12cd34.png"));
    expect(onDisk.equals(PNG_1PX)).toBe(true);
    // The request carried auth + the intent/aspect passthrough.
    expect(stub.requests[0]?.auth).toBe("Bearer vlk_test");
    expect(stub.requests[0]?.body).toEqual({
      prompt: "hero art",
      intent: "photo",
      aspect: "3:2",
    });
  });

  test("a raster result carries its pixel size, so <Image> can be sized to it", async () => {
    // `<Image>` fills its parent: handed a src with no matching aspect it lays
    // out at zero height, so a paid, fully successful generation shows nothing.
    const r = await generateAsset(tmp, cloud(), { prompt: "hero art", intent: "photo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assets[0]?.width).toBe(1);
    expect(r.value.assets[0]?.height).toBe(1);
    expect(r.value.width).toBe(1);
    expect(r.value.height).toBe(1);
  });

  test("provenance lands in assets.json, so the prompt outlives the transcript", async () => {
    const r = await generateAsset(tmp, cloud(), {
      prompt: "hero art",
      intent: "photo",
      aspect: "3:2",
      replaces: "assets/placeholder.png",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const store = JSON.parse(await readFile(join(tmp, "assets.json"), "utf8"));
    const entry = store.generated["assets/gen_ab12cd34.png"];
    expect(entry.prompt).toBe("hero art");
    expect(entry.intent).toBe("photo");
    expect(entry.aspect).toBe("3:2");
    // ...and it must not be written into the design folder either.
    expect(entry.model).toBeUndefined();
    expect(entry.width).toBe(1);
    expect(entry.height).toBe(1);
    expect(entry.replaces).toBe("assets/placeholder.png");
    expect(Number.isFinite(Date.parse(entry.generatedAt))).toBe(true);
  });

  test("every variant of a multi-result generation is recorded", async () => {
    stub.body = imageSuccess("gen_multi", 3);
    const r = await generateAsset(tmp, cloud(), { prompt: "hero art", intent: "photo", count: 3 });
    expect(r.ok).toBe(true);
    const store = JSON.parse(await readFile(join(tmp, "assets.json"), "utf8"));
    expect(Object.keys(store.generated).sort()).toEqual([
      "assets/gen_multi-1.png",
      "assets/gen_multi-2.png",
      "assets/gen_multi-3.png",
    ]);
  });

  test("count > 1 stores every variant under a numbered stem", async () => {
    stub.body = imageSuccess("gen_multi", 3);
    const r = await generateAsset(tmp, cloud(), { prompt: "hero art", intent: "photo", count: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assets.map((a) => a.assetPath)).toEqual([
      "assets/gen_multi-1.png",
      "assets/gen_multi-2.png",
      "assets/gen_multi-3.png",
    ]);
    // The flat mirror still points at the first, for the common single case.
    expect(r.value.assetPath).toBe("assets/gen_multi-1.png");
    expect(r.value.cost).toBe("cost $0.12, balance $11.75");
    for (const n of [1, 2, 3]) {
      expect((await readFile(join(tmp, "assets", `gen_multi-${n}.png`))).equals(PNG_1PX)).toBe(
        true,
      );
    }
    expect(stub.requests[0]?.body).toEqual({ prompt: "hero art", intent: "photo", count: 3 });
  });

  test("count: 1 is not sent — the cloud default stands", async () => {
    await generateAsset(tmp, cloud(), { prompt: "hero art", intent: "photo", count: 1 });
    expect(stub.requests[0]?.body).toEqual({ prompt: "hero art", intent: "photo" });
  });

  test("a pre-variant cloud reply (bare kind/dataUrl) is still understood", async () => {
    stub.body = {
      id: "gen_legacy",
      kind: "image",
      dataUrl: PNG_DATA_URL,
      chargedMicros: 250_000,
      balanceMicros: 11_750_000,
    };
    const r = await generateAsset(tmp, cloud(), { prompt: "hero art", intent: "photo" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assets.length).toBe(1);
    expect(r.value.assetPath).toBe("assets/gen_legacy.png");
    expect(r.value.cost).toBe("cost $0.25, balance $11.75");
  });

  test("svg: stores the markup and returns it inline for <SVG content>", async () => {
    stub.body = svgSuccess();
    const r = await generateAsset(tmp, cloud(), { prompt: "a mark", intent: "mark" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/gen_ef56ab78.svg");
    expect(r.value.content).toBe(SVG_MARKUP);
    expect(r.value.cost).toBe("cost $0.05, balance $0.95");
    expect(await readFile(join(tmp, "assets", "gen_ef56ab78.svg"), "utf8")).toBe(SVG_MARKUP);
  });

  test("filename stem overrides the id and is sanitized", async () => {
    stub.body = svgSuccess();
    const r = await generateAsset(tmp, cloud(), {
      prompt: "a mark",
      intent: "mark",
      filename: "../evil/brand mark.svg",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.assetPath).toBe("assets/brand_mark.svg");
    expect(stub.requests[0]?.body).toEqual({ prompt: "a mark", intent: "mark" });
  });

  test("a reference is read from the folder and sent inline as a data URI", async () => {
    await mkdir(join(tmp, "assets"), { recursive: true });
    await writeFile(join(tmp, "assets", "source.png"), PNG_1PX);
    const r = await generateAsset(tmp, cloud(), {
      prompt: "a stylized version of this",
      intent: "illustration",
      reference: ["assets/source.png"],
    });
    expect(r.ok).toBe(true);
    expect((stub.requests[0]?.body as { reference?: string[] })?.reference).toEqual([PNG_DATA_URL]);
  });

  test("a leading-slash canvas URL resolves to the same folder asset", async () => {
    await mkdir(join(tmp, "assets"), { recursive: true });
    await writeFile(join(tmp, "assets", "source.png"), PNG_1PX);
    await generateAsset(tmp, cloud(), {
      prompt: "cut it out",
      intent: "cutout",
      reference: ["/assets/source.png"],
    });
    expect((stub.requests[0]?.body as { reference?: string[] })?.reference).toEqual([PNG_DATA_URL]);
  });

  test("a reference outside the folder is refused before any network call", async () => {
    for (const bad of ["../../etc/passwd", "/etc/passwd", "assets/../../secret.png"]) {
      const r = await generateAsset(tmp, cloud(), {
        prompt: "x",
        intent: "cutout",
        reference: [bad],
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("InvalidRequest");
    }
    expect(stub.requests.length).toBe(0);
  });

  test("a missing or non-image reference is a clear local error, not a cloud round-trip", async () => {
    const missing = await generateAsset(tmp, cloud(), {
      prompt: "x",
      intent: "cutout",
      reference: ["assets/nope.png"],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(describeGenerateFailure(missing.error)).toContain("doesn't exist");

    await mkdir(join(tmp, "assets"), { recursive: true });
    await writeFile(join(tmp, "assets", "notes.txt"), "hello");
    const wrongType = await generateAsset(tmp, cloud(), {
      prompt: "x",
      intent: "cutout",
      reference: ["assets/notes.txt"],
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok)
      expect(describeGenerateFailure(wrongType.error)).toContain("supported image");
    expect(stub.requests.length).toBe(0);
  });
});

describe("failure statuses map to actionable messages", () => {
  const reject = (status: number, error: string, message: string) => {
    stub.status = status;
    stub.body = { error, message };
  };

  const generate = async () => {
    const r = await generateAsset(tmp, cloud(), { prompt: "x", intent: "photo" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    if (r.error.kind !== "HttpFailure")
      throw new Error(`expected HttpFailure, got ${r.error.kind}`);
    return r.error;
  };

  // A 401 is the one status that is not an HTTP fault: it classifies as
  // `LoggedOut` so every caller can offer a sign-in instead of a status line.
  test("401 becomes LoggedOut, keeping the cloud's message and the way back", async () => {
    reject(401, "unauthorized", "Invalid or expired token.");
    const r = await generateAsset(tmp, cloud(), { prompt: "x", intent: "photo" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error.kind).toBe("LoggedOut");
    expect(describeGenerateFailure(r.error)).toContain("Invalid or expired token.");
    expect(describeGenerateFailure(r.error)).toContain("velloo login");
  });

  test("400 passes the cloud's validation message through", async () => {
    reject(400, "bad_request", "prompt must be 1..2000 characters");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("prompt must be 1..2000 characters");
  });

  test("an unpunctuated cloud message and the hint stay two sentences", async () => {
    // The cloud's messages don't reliably end in a period, and the hint is
    // appended straight after: "…in 'reference' Fix the arguments and retry"
    // read as one mangled sentence to the agent that has to act on it.
    reject(400, "bad_request", "intent 'edit' works on an existing image — name the source asset");
    const e = await generate();
    expect(describeGenerateFailure(e)).toBe(
      "intent 'edit' works on an existing image — name the source asset. " +
        "Fix the arguments and retry — nothing was generated or charged.",
    );
  });

  test("a cloud message that already ends in punctuation gains no second period", async () => {
    reject(400, "bad_request", "prompt must be 1..2000 characters.");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("characters. Fix the arguments");
    expect(describeGenerateFailure(e)).not.toContain("characters.. ");
  });

  test("400 for an unknown intent relays the server's catalogue verbatim", async () => {
    reject(
      400,
      "bad_request",
      "unknown intent 'photograph' — valid intents: photo (Realistic marketing…), vector (True SVG output…)",
    );
    const r = await generateAsset(tmp, cloud(), { prompt: "x", intent: "photo" });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toMatchObject({ kind: "HttpFailure", status: 400 });
    expect(describeGenerateFailure(r.error)).toContain("valid intents: photo");
    expect(describeGenerateFailure(r.error)).toContain("vector (True SVG output…)");
  });

  test("402 keeps the cloud's price/balance/top-up text and adds the way out", async () => {
    reject(
      402,
      "insufficient_credits",
      "Insufficient credits: image generation costs $0.25, balance $0.10. Top up at https://velloo.design/account.",
    );
    const e = await generate();
    expect(e.status).toBe(402);
    expect(describeGenerateFailure(e)).toContain("Top up at https://velloo.design/account");
    expect(describeGenerateFailure(e)).toContain("top up credits");
  });

  test("404 (feature off) says hosted generation isn't available here", async () => {
    reject(404, "not_found", "Asset generation is not enabled on this server.");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("not enabled");
    expect(describeGenerateFailure(e)).toContain("isn't available");
    expect(describeGenerateFailure(e)).not.toContain("upload_asset");
  });

  test("429 says to wait and retry", async () => {
    reject(429, "rate_limited", "Rate limit exceeded: 10 generations per minute per account.");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("10 generations per minute");
    expect(describeGenerateFailure(e)).toContain("wait a minute");
  });

  test("502 generation_failed relays that no credits were charged, and says it once", async () => {
    reject(502, "generation_failed", "The provider failed to generate; no credits were charged.");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("no credits were charged");
    expect(describeGenerateFailure(e)).toContain("Retry once");
    // The hint used to restate the cloud's own closing clause back at the agent.
    expect(
      describeGenerateFailure(e).toLowerCase().split("no credits were charged").length - 1,
    ).toBe(1);
  });

  test("503 (provider unconfigured) says hosted generation isn't available here", async () => {
    reject(503, "unavailable", "No generation provider is configured.");
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("No generation provider is configured.");
    expect(describeGenerateFailure(e)).toContain("isn't available");
    expect(describeGenerateFailure(e)).not.toContain("upload_asset");
  });

  test("a body without a message still yields a readable error", async () => {
    stub.status = 500;
    stub.body = "gateway soup";
    const e = await generate();
    expect(describeGenerateFailure(e)).toContain("500");
  });
});

test("a malformed dataUrl is rejected without writing anything", async () => {
  stub.body = imageSuccess("gen_ab12cd34", 1, "data:image/webp;base64,AAAA");
  const r = await generateAsset(tmp, cloud(), { prompt: "x", intent: "photo" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe("ProtocolViolation");
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
    stub.body = svgSuccess(
      "gen_ef56ab78",
      `data:image/svg+xml;base64,${Buffer.from(active).toString("base64")}`,
    );
    const r = await generateAsset(tmp, cloud(), { prompt: "a mark", intent: "mark" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("ProtocolViolation");
      expect(describeGenerateFailure(r.error)).toContain("refusing");
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
      providers: { default: provider },
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
      arguments: { prompt: "hero art", intent: "photo" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBeFalsy();
    expect(text).toContain("assets/gen_ab12cd34.png");
    expect(text).toContain("cost $0.04, balance $11.75");
    await client.close();
  });

  test("logged out surfaces as an isError result naming `velloo login`", async () => {
    const client = await connectTool();
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "hero art", intent: "photo" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBe(true);
    expect(text).toContain("velloo login");
    await client.close();
  });

  test("a cloud 402 surfaces the top-up path in the tool text", async () => {
    stub.status = 402;
    stub.body = {
      error: "insufficient_credits",
      message: "Insufficient credits: this costs $0.18, balance $0.13. Top up to continue.",
    };
    const client = await connectTool("vlk_test");
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "a logo", intent: "vector" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(res.isError).toBe(true);
    expect(text).toContain("Top up to continue.");
    expect(text).toContain("top up credits");
    expect(stub.requests[0]?.body).toEqual({ prompt: "a logo", intent: "vector" });
    await client.close();
  });

  test("an unknown intent never reaches the wire — the enum rejects it locally", async () => {
    const client = await connectTool("vlk_test");
    const res = await client.callTool({
      name: "generate_asset",
      arguments: { prompt: "hero art", intent: "photograph" },
    });
    expect(res.isError).toBe(true);
    expect(stub.requests.length).toBe(0);
    await client.close();
  });
});
