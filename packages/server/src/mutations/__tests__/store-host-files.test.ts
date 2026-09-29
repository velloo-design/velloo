import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { captureDir, writeCaptureManifest } from "@velloo/renderer";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { storeHostFiles } from "../store-host-files.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What Chromium's `Page.captureSnapshot` writes: the page and every resource it loaded. */
const mhtml = (origin: string) =>
  [
    "From: <Saved by Blink>",
    `Snapshot-Content-Location: ${origin}/dashboard`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----B----"',
    "",
    "",
    "------B----",
    "Content-Type: text/html",
    "Content-Transfer-Encoding: quoted-printable",
    `Content-Location: ${origin}/dashboard`,
    "",
    `<html><head><link rel=3D"stylesheet" href=3D"/build/app.css?v=3D1"></head><body></bo=\r\ndy></html>`,
    "------B----",
    "Content-Type: text/css",
    "Content-Transfer-Encoding: quoted-printable",
    `Content-Location: ${origin}/build/app.css?v=1`,
    "",
    ".hero { color: rgb(1, 2, 3); background: url(/img/hero.png); }",
    "------B----",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    `Content-Location: ${origin}/img/hero.png`,
    "",
    Buffer.from(PNG).toString("base64"),
    "------B------",
    "",
  ].join("\r\n");

let t: TestContext;
let home: string;
const prevHome = process.env.VELLOO_HOME;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "velloo-home-"));
  process.env.VELLOO_HOME = home;
  t = await testContext({
    label: "store-host-files",
    provider: createHtmlProvider(),
    config: { library: { id: "html" }, styling: { framework: "none" }, hostApp: { root: "app" } },
    screens: {
      home: {
        id: "home",
        name: "Home",
        tree: { $ref: "Html", props: { as: "img", src: "/static/logo.png" } },
      },
    },
  });
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.VELLOO_HOME;
  else process.env.VELLOO_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  await t.cleanup();
});

describe("storeHostFiles", () => {
  test("from source: finds each file by the path the app serves it at", async () => {
    // The app mounts `app/web/static` at `/static`; the URL prefix doesn't name the directory.
    await t.write("app/web/static/site.css", ".a { background: url(img/a.png); }");
    await mkdir(join(t.root, "app/web/static/img"), { recursive: true });
    await writeFile(join(t.root, "app/web/static/img/a.png"), PNG);
    await writeFile(join(t.root, "app/web/static/logo.png"), PNG);

    const result = await storeHostFiles(t.ctx, {
      from: "source",
      stylesheets: ["/static/site.css"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stored.sort()).toEqual([
      "assets/host/static/img/a.png",
      "assets/host/static/logo.png",
      "assets/host/static/site.css",
    ]);
    expect(await readFile(join(t.root, "assets/host/static/site.css"), "utf8")).toBe(
      '.a { background: url("/assets/host/static/img/a.png"); }',
    );
    // The design keeps naming the app's own path; only the copy moved.
    expect(t.ctx.folder.screens.get("home")?.tree).toMatchObject({
      props: { src: "/static/logo.png" },
    });
    const config = JSON.parse(await readFile(join(t.root, ".design/config.json"), "utf8"));
    expect(config.hostApp).toEqual({ root: "app", stylesheets: ["/static/site.css"] });
    expect(t.events).toContainEqual({ type: "config-changed" });
  });

  test("from a capture: the page's linked stylesheets and what they load, built CSS included", async () => {
    const origin = "http://127.0.0.1:8086";
    const dir = captureDir(t.root, "cap1");
    writeCaptureManifest(dir, {
      id: "cap1",
      url: `${origin}/dashboard`,
      finalUrl: `${origin}/dashboard`,
      title: "Dashboard",
      capturedAt: "2026-09-29T12:00:00.000Z",
      viewport: { w: 1200, h: 800 },
      files: ["snapshot.mhtml"],
      assetCount: 0,
      nodeCount: 1,
      themeOnly: false,
    });
    await writeFile(join(dir, "snapshot.mhtml"), mhtml(origin), "latin1");

    const result = await storeHostFiles(t.ctx, { from: { captureId: "cap1" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stylesheets).toEqual(["/build/app.css"]);
    expect(await readFile(join(t.root, "assets/host/build/app.css"), "utf8")).toBe(
      '.hero { color: rgb(1, 2, 3); background: url("/assets/host/img/hero.png"); }',
    );
    expect(new Uint8Array(await readFile(join(t.root, "assets/host/img/hero.png")))).toEqual(PNG);
    // The capture has no logo, so the design doesn't either — and says so.
    expect(existsSync(join(t.root, "assets/host/static/logo.png"))).toBe(false);
    expect(result.value.warnings.join()).toContain("/static/logo.png");
  });

  test("an unknown capture changes nothing", async () => {
    const result = await storeHostFiles(t.ctx, { from: { captureId: "nope" } });
    expect(result.ok).toBe(false);
    expect(existsSync(join(t.root, "assets/host"))).toBe(false);
  });

  test("a design that isn't HTML is refused", async () => {
    const shadcn = await testContext({ label: "store-host-files-shadcn" });
    try {
      const result = await storeHostFiles(shadcn.ctx, { from: "source" });
      expect(result.ok).toBe(false);
    } finally {
      await shadcn.cleanup();
    }
  });
});
