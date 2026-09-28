import { describe, expect, test } from "bun:test";
import type { Screen } from "@velloo/schema";
import { shipHostFiles } from "../host-files.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A local service that answers everything — the case a repository's committed config could aim at. */
function service(routes: Record<string, { body: string | Uint8Array; type: string }>) {
  const asked: string[] = [];
  const fake = (async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    asked.push(pathname);
    const route = routes[pathname];
    return route
      ? new Response(route.body, { headers: { "content-type": route.type } })
      : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fake, asked };
}

const screen = (props: Record<string, unknown>): Screen => ({
  id: "s",
  name: "S",
  tree: { $ref: "Html", props: { as: "img", ...props } },
});

const ship = (fake: typeof fetch, opts: { stylesheets?: string[]; screens?: Screen[] } = {}) => {
  const warnings: string[] = [];
  return shipHostFiles({
    origin: new URL("http://127.0.0.1:9999"),
    stylesheets: opts.stylesheets ?? [],
    screens: opts.screens ?? [],
    snippets: [],
    warn: (message) => warnings.push(message),
    fetch: fake,
  }).then((result) => ({ ...result, warnings }));
};

describe("shipHostFiles", () => {
  test("a stylesheet entry that names another endpoint is never fetched or shipped", async () => {
    const { fake, asked } = service({
      "/admin/api/keys": { body: '{"key":"secret"}', type: "application/json" },
    });
    const result = await ship(fake, { stylesheets: ["/admin/api/keys"] });
    expect(asked).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.stylesheets).toEqual([]);
    expect(result.warnings[0]).toContain(".css");
  });

  test("a .css path that answers with something other than CSS stays unpublished", async () => {
    const { fake } = service({
      "/leak.css": { body: '{"key":"secret"}', type: "application/json" },
    });
    const result = await ship(fake, { stylesheets: ["/leak.css"] });
    expect(result.files).toEqual([]);
    expect(result.warnings[0]).toContain("text/css");
  });

  test("real CSS ships with its url()s re-pointed at shipped copies", async () => {
    const { fake } = service({
      "/static/css/app.css": {
        body: ".a{background:url(../img/a.png)}",
        type: "text/css; charset=utf-8",
      },
      "/static/img/a.png": { body: PNG, type: "image/png" },
    });
    const result = await ship(fake, { stylesheets: ["/static/css/app.css"] });
    expect(result.stylesheets).toEqual(["assets/host/static/css/app.css"]);
    expect(new TextDecoder().decode(result.files.find((f) => f.type === "text/css")?.bytes)).toBe(
      '.a{background:url("/assets/host/static/img/a.png")}',
    );
  });

  test("an image reference ships only real image bytes, and never climbs out of the app", async () => {
    const { fake, asked } = service({
      "/static/a.png": { body: PNG, type: "image/png" },
      "/api/secret.png": { body: '{"key":"secret"}', type: "image/png" },
    });
    const result = await ship(fake, {
      screens: [
        screen({ src: "/static/a.png" }),
        screen({ src: "/api/secret.png" }),
        screen({ src: "/static/../../etc/passwd.png" }),
        screen({ src: "/static/%2e%2e/x.png" }),
      ],
    });
    expect(result.files.map((f) => f.path)).toEqual(["assets/host/static/a.png"]);
    expect(asked).not.toContain("/etc/passwd.png");
    expect(result.screens[0]?.tree).toMatchObject({ props: { src: "/assets/host/static/a.png" } });
    expect(result.screens[1]?.tree).toMatchObject({ props: { src: "/api/secret.png" } });
  });

  test("with no local origin nothing is fetched and the trees travel unchanged", async () => {
    const { fake, asked } = service({});
    const screens = [screen({ src: "/static/a.png" })];
    const result = await shipHostFiles({
      origin: null,
      stylesheets: ["/static/app.css"],
      screens,
      snippets: [],
      warn: () => {},
      fetch: fake,
    });
    expect(asked).toEqual([]);
    expect(result.screens).toBe(screens);
  });
});
