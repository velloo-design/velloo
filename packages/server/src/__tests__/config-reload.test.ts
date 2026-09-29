import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WatchEvent } from "@velloo/protocol";
import type { Config } from "@velloo/schema";
import { createServer, type ServerHandle } from "../index.ts";
import {
  designConfig,
  type ScaffoldedFolder,
  scaffoldDesignFolder,
} from "../testing/design-folder.ts";

/**
 * A hand edit to `.design/config.json` reaches the running daemon: it goes live
 * without a restart, an invalid edit is ignored, a field resolved at boot waits
 * for the restart without the daemon's own writes undoing it, and a new app
 * root's source edits refresh the canvas.
 */

async function eventually<T>(read: () => Promise<T> | T, done: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - started < 3_000) {
    await Bun.sleep(25);
    value = await read();
  }
  return value;
}

describe("config hot reload", () => {
  let folder: ScaffoldedFolder;
  let server: ServerHandle;
  let socket: WebSocket;
  let config: Config;
  const events: WatchEvent[] = [];
  const errors = spyOn(console, "error").mockImplementation(() => {});

  beforeAll(async () => {
    config = designConfig({ library: { id: "none" } });
    folder = await scaffoldDesignFolder({ label: "config-reload", config, nested: true });
    server = await createServer({ folder: folder.root, port: 0 });
    socket = new WebSocket(`${server.url.replace("http", "ws")}/ws`);
    socket.onmessage = (message) => events.push(JSON.parse(String(message.data)) as WatchEvent);
    await new Promise((resolve) => {
      socket.onopen = resolve;
    });
  });

  afterEach(() => {
    errors.mockClear();
    events.length = 0;
  });

  afterAll(async () => {
    socket?.close();
    await server?.close();
    await folder?.cleanup();
    errors.mockRestore();
  });

  const configPath = () => join(folder.root, ".design/config.json");
  const onDisk = async () => JSON.parse(await readFile(configPath(), "utf8")) as Config;
  const design = async () =>
    (await (await fetch(`${server.url}/api/design`)).json()) as {
      designName: string;
      libraries: Record<string, unknown>;
      viewportPresets: Array<{ name: string }>;
    };

  test("a hand edit goes live and tells the canvas", async () => {
    config = { ...config, name: "renamed" };
    await folder.write(".design/config.json", config);
    expect((await eventually(design, (d) => d.designName === "renamed")).designName).toBe(
      "renamed",
    );
    expect(events).toContainEqual({ type: "config-changed" });
  });

  test("an edit that no longer parses is ignored", async () => {
    const before = (await design()).designName;
    await folder.write(".design/config.json", '{ "schemaVersion": ');
    await eventually(
      () => errors.mock.calls.length,
      (calls) => calls > 0,
    );
    expect(String(errors.mock.calls[0]?.[0])).toContain("failed to reload");
    expect((await design()).designName).toBe(before);
    await folder.write(".design/config.json", config);
    await eventually(
      () => events.length,
      (n) => n > 0,
    );
  });

  test("a boot-bound field waits for the restart, and daemon writes keep it on disk", async () => {
    const libraries = { ...config.libraries, extra: { ...config.libraries.default, id: "none" } };
    await folder.write(".design/config.json", { ...config, name: "edited", libraries });
    await eventually(design, (d) => d.designName === "edited");
    expect(Object.keys((await design()).libraries)).toEqual(["default"]);
    const notices = () =>
      errors.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("restart"));
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain("libraries");

    const response = await fetch(`${server.url}/api/mutate/update_viewport_presets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presets: [{ name: "Phone", w: 390, h: 844 }] }),
    });
    expect(response.status).toBe(200);
    const written = await onDisk();
    expect(Object.keys(written.libraries).sort()).toEqual(["default", "extra"]);
    expect(written.viewportPresets).toEqual([{ name: "Phone", w: 390, h: 844 }]);
    expect(Object.keys((await design()).libraries)).toEqual(["default"]);
    // The write coming back through the watcher is not a new edit to announce.
    await Bun.sleep(400);
    expect(notices()).toHaveLength(1);

    config = { ...written, libraries: config.libraries };
    await folder.write(".design/config.json", config);
    await eventually(
      async () => (await onDisk()).libraries,
      (l) => Object.keys(l).length === 1,
    );
  });

  test("a new host app's source edits refresh the canvas", async () => {
    const page = join(folder.root, "../admin/src/page.tsx");
    await mkdir(dirname(page), { recursive: true });
    await writeFile(page, "export default 1;\n");
    config = { ...config, hostApps: { admin: { root: "../admin" } } };
    await folder.write(".design/config.json", config);
    await eventually(
      () => events.some((e) => e.type === "config-changed"),
      (seen) => seen,
    );
    events.length = 0;
    await Bun.sleep(100);
    await writeFile(page, "export default 2;\n");
    const reloaded = await eventually(
      () => events.some((e) => e.type === "folder-reloaded"),
      (seen) => seen,
    );
    expect(reloaded).toBe(true);
  });
});

describe("HTML stylesheets after a config edit", () => {
  let folder: ScaffoldedFolder;
  let server: ServerHandle;
  const htmlConfig = (stylesheets: string[]) => ({
    library: { id: "html" as const },
    styling: { framework: "none" as const },
    hostApp: { root: ".", stylesheets },
  });

  beforeAll(async () => {
    folder = await scaffoldDesignFolder({
      label: "config-reload-html",
      config: htmlConfig(["/static/first.css"]),
      screens: { home: { id: "home", name: "Home", tree: { $ref: "Html", props: {} } } },
    });
    server = await createServer({ folder: folder.root, port: 0 });
  });

  afterAll(async () => {
    await server?.close();
    await folder?.cleanup();
  });

  test("the design links a new stylesheet list without a restart", async () => {
    const rendered = async () => (await fetch(`${server.url}/api/render/home?w=400&h=300`)).text();
    expect(await rendered()).toContain('data-velloo-host-stylesheet="/static/first.css"');
    await folder.write(".design/config.json", designConfig(htmlConfig(["/static/second.css"])));
    expect(await eventually(rendered, (html) => html.includes('"/static/second.css"'))).toContain(
      'data-velloo-host-stylesheet="/static/second.css"',
    );
  });
});
