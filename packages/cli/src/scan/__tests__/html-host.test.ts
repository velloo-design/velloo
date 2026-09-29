import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stylesheetsInSource } from "../html-host.ts";

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

describe("stylesheetsInSource", () => {
  test("reads the stylesheets templates and page code link", async () => {
    await write(
      "internal/view/layout.go",
      'nodx.Link(nodx.Rel("stylesheet"), href("/build/style.min.css?v=1")),\nhref("/not/a/sheet.css"),\n',
    );
    await write(
      "templates/base.html",
      `<link rel="stylesheet" href="{{ url_for('static', filename='css/site.css') }}">`,
    );
    expect(stylesheetsInSource(root)).toEqual(["/build/style.min.css", "/static/css/site.css"]);
  });

  test("an app that links none has none", async () => {
    await write("app.py", "");
    expect(stylesheetsInSource(root)).toEqual([]);
  });
});
