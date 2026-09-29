import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appSourceHostFiles, parseMhtml, stylesheetsInPage } from "../host-file-sources.ts";

const app = await mkdtemp(join(tmpdir(), "velloo-host-source-"));
afterAll(() => rm(app, { recursive: true, force: true }));
const put = async (path: string, text: string) => {
  await mkdir(dirname(join(app, path)), { recursive: true });
  await writeFile(join(app, path), text);
};
await put("internal/view/static/build/style.min.css", "built");
await put("web/static/site.css", "site");
await put("other/deep/nested/static/site.css", "a longer path to the same name");
await put("themes/site.css", "one segment matches");
await put("node_modules/pkg/static/site.css", "a dependency");
await put("velloo/assets/host/build/style.min.css", "the design's own copy");
await put("velloo/assets/host/static/only-stored.css", "only the design has it");

const text = async (bytes: Promise<Uint8Array | null>) => {
  const read = await bytes;
  return read ? new TextDecoder().decode(read) : null;
};

describe("appSourceHostFiles", () => {
  const source = appSourceHostFiles(app, [join(app, "velloo")]);

  test("finds a file under whatever directory the app mounts at its URL prefix", async () => {
    expect(await text(source.read("build/style.min.css"))).toBe("built");
  });

  test("prefers the shortest path among equally good matches, never a dependency", async () => {
    expect(await text(source.read("static/site.css"))).toBe("site");
  });

  test("a bare file name doesn't match a multi-segment URL path", async () => {
    expect(await source.read("css/site.css")).toBeNull();
  });

  test("never reads the design's stored copies as the app's files", async () => {
    expect(await source.read("static/only-stored.css")).toBeNull();
  });
});

test("parseMhtml decodes quoted-printable and base64 parts with their URLs", () => {
  const archive = [
    'Content-Type: multipart/related; boundary="--X"',
    "",
    "----X",
    "Content-Type: text/css",
    "Content-Transfer-Encoding: quoted-printable",
    "Content-Location: http://127.0.0.1:1/a.css",
    "",
    "a { content: =22=E2=9C=93=22; wid=",
    "th: 1px }",
    "----X",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-Location: http://127.0.0.1:1/b.png",
    "",
    "iVBORw==",
    "----X--",
  ].join("\r\n");
  const [css, png] = parseMhtml(archive);
  expect(css?.location).toBe("http://127.0.0.1:1/a.css");
  expect(new TextDecoder().decode(css?.bytes)).toBe('a { content: "✓"; width: 1px }');
  expect(png?.type).toBe("image/png");
  expect([...(png?.bytes ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("stylesheetsInPage keeps same-origin paths without cache-busters, and https URLs", () => {
  const html =
    '<link rel="stylesheet" href="/build/style.min.css?v=34b1622f">' +
    '<link rel="stylesheet" href="https://cdn.example.com/x.css">' +
    '<link rel="stylesheet" href="http://insecure.example.com/y.css">' +
    '<link rel="icon" href="/favicon.png">';
  expect(stylesheetsInPage(html, new URL("http://127.0.0.1:8085/auth/login"))).toEqual([
    "/build/style.min.css",
    "https://cdn.example.com/x.css",
  ]);
});
