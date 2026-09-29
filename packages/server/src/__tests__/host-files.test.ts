import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Screen } from "@velloo/schema";
import { type HostFileSource, shipHostFiles } from "../host-files.ts";
import { storedHostFile } from "../routes/host-files.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An app whose files are whatever the test says — the case a repository's committed config could aim at. */
function service(files: Record<string, string | Uint8Array>) {
  const asked: string[] = [];
  const source: HostFileSource = {
    label: "the app's source",
    read: async (path) => {
      asked.push(`/${path}`);
      const file = files[`/${path}`];
      return file === undefined
        ? null
        : typeof file === "string"
          ? new TextEncoder().encode(file)
          : file;
    },
  };
  return { source, asked };
}

const screen = (props: Record<string, unknown>): Screen => ({
  id: "s",
  name: "S",
  tree: { $ref: "Html", props: { as: "img", ...props } },
});

const ship = (
  source: HostFileSource,
  opts: { stylesheets?: string[]; screens?: Screen[] } = {},
) => {
  const warnings: string[] = [];
  return shipHostFiles({
    source,
    stylesheets: opts.stylesheets ?? [],
    screens: opts.screens ?? [],
    snippets: [],
    warn: (message) => warnings.push(message),
  }).then((result) => ({ ...result, warnings }));
};

describe("shipHostFiles", () => {
  test("a stylesheet entry that names some other file is never read or stored", async () => {
    const { source, asked } = service({ "/admin/api/keys": '{"key":"secret"}' });
    const result = await ship(source, { stylesheets: ["/admin/api/keys"] });
    expect(asked).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.stylesheets).toEqual([]);
    expect(result.warnings[0]).toContain(".css");
  });

  test("real CSS is stored with its url()s re-pointed at the stored copies", async () => {
    const { source } = service({
      "/static/css/app.css": ".a{background:url(../img/a.png)}",
      "/static/img/a.png": PNG,
    });
    const result = await ship(source, { stylesheets: ["/static/css/app.css"] });
    expect(result.stylesheets).toEqual(["assets/host/static/css/app.css"]);
    expect(new TextDecoder().decode(result.files.find((f) => f.type === "text/css")?.bytes)).toBe(
      '.a{background:url("/assets/host/static/img/a.png")}',
    );
  });

  test("an image reference stores only real image bytes, and never climbs out of the app", async () => {
    const { source, asked } = service({
      "/static/a.png": PNG,
      "/api/secret.png": '{"key":"secret"}',
    });
    const result = await ship(source, {
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

  test("a file the source doesn't have is left out, with a warning naming the source", async () => {
    const { source } = service({});
    const result = await ship(source, { stylesheets: ["/static/app.css"] });
    expect(result.files).toEqual([]);
    expect(result.warnings[0]).toContain("the app's source");
  });
});

describe("storedHostFile", () => {
  test("finds only files inside the design's host copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "velloo-stored-"));
    try {
      await mkdir(join(root, "assets/host/static"), { recursive: true });
      await writeFile(join(root, "assets/host/static/app.css"), "x");
      await writeFile(join(root, "secret.json"), "{}");
      expect(storedHostFile(root, "/static/app.css")).toBe(
        join(root, "assets/host/static/app.css"),
      );
      expect(storedHostFile(root, "/static/missing.css")).toBeUndefined();
      expect(storedHostFile(root, "/../../secret.json")).toBeUndefined();
      expect(storedHostFile(root, "/")).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
