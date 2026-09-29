import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectHostPort, detectHtmlHost, stylesheetsInPage } from "../html-host.ts";

let root: string;

async function write(rel: string, content: string): Promise<void> {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

beforeEach(async () => {
  root = join(tmpdir(), `velloo-html-host-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const refused: typeof fetch = Object.assign(
  async () => {
    throw new TypeError("Unable to connect");
  },
  { preconnect: () => {} },
);

describe("detectHostPort", () => {
  test("a Go env struct tag's default", async () => {
    await write("go.mod", "module x\n");
    await write(
      "internal/config/env.go",
      'type Env struct {\n\tPORT string `env:"APP_LISTEN_PORT" envDefault:"8085"`\n}\n',
    );
    expect(detectHostPort(root)).toBe(8085);
  });

  test("a Go listen call, and the Go default without one", async () => {
    await write("go.mod", "module x\n");
    expect(detectHostPort(root)).toBe(8080);
    await write("main.go", 'func main() { e.Start(":1323") }\n');
    expect(detectHostPort(root)).toBe(1323);
  });

  test("an env file wins over the source", async () => {
    await write("app.py", "app.run(debug=True, port=5001)\n");
    expect(detectHostPort(root)).toBe(5001);
    await write(".env", 'FLASK_PORT="5055"\n');
    expect(detectHostPort(root)).toBe(5055);
  });

  test("framework defaults by entry file", async () => {
    await write("manage.py", "");
    expect(detectHostPort(root)).toBe(8000);
  });
});

describe("stylesheetsInPage", () => {
  test("same-origin paths without their cache-buster, https kept, other origins dropped", () => {
    const html = `<head>
      <link rel="stylesheet" href="/build/style.min.css?v=34b1622f">
      <link href='css/site.css' rel='stylesheet'>
      <link rel="icon" href="/favicon.ico">
      <link rel="stylesheet" href="https://cdn.example.com/lib.css">
      <link rel="stylesheet" href="http://cdn.example.com/insecure.css">
    </head>`;
    expect(stylesheetsInPage(html, new URL("http://127.0.0.1:8085/auth/login"))).toEqual([
      "/build/style.min.css",
      "/auth/css/site.css",
      "https://cdn.example.com/lib.css",
    ]);
  });
});

describe("detectHtmlHost", () => {
  test("reads the running app's page, following its redirect", async () => {
    await write("go.mod", "module x\n");
    const requested: string[] = [];
    const get = Object.assign(
      async (input: string | URL | Request) => {
        requested.push(String(input));
        const response = new Response('<link rel="stylesheet" href="/static/app.css">', {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
        Object.defineProperty(response, "url", { value: "http://127.0.0.1:8080/auth/login" });
        return response;
      },
      { preconnect: () => {} },
    );
    expect(await detectHtmlHost(root, "/dashboard", get)).toEqual({
      previewUrl: "http://127.0.0.1:8080",
      stylesheets: ["/static/app.css"],
      reachable: true,
    });
    expect(requested).toEqual(["http://127.0.0.1:8080/dashboard"]);
  });

  test("an app that isn't running: stylesheets from templates and page code", async () => {
    await write("go.mod", "module x\n");
    await write(
      "internal/view/layout.go",
      'nodx.Link(nodx.Rel("stylesheet"), href("/build/style.min.css?v=1")),\nhref("/not/a/sheet.css"),\n',
    );
    await write(
      "templates/base.html",
      `<link rel="stylesheet" href="{{ url_for('static', filename='css/site.css') }}">`,
    );
    expect(await detectHtmlHost(root, "/", refused)).toEqual({
      previewUrl: "http://127.0.0.1:8080",
      stylesheets: ["/build/style.min.css", "/static/css/site.css"],
      reachable: false,
    });
  });

  test("no stylesheets found leaves the list out", async () => {
    await write("app.py", "");
    expect(await detectHtmlHost(root, "/", refused)).toEqual({
      previewUrl: "http://127.0.0.1:5000",
      reachable: false,
    });
  });
});
