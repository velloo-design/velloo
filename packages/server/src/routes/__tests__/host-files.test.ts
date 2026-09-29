import { afterAll, describe, expect, test } from "bun:test";
import { HOST_FILES_PREFIX } from "@velloo/renderer";
import { scaffoldDesignFolder } from "../../testing/design-folder.ts";
import { hostAssetRequest, hostFilesFetch } from "../host-files.ts";

const folder = await scaffoldDesignFolder({ label: "host-files-route" });
await folder.write("assets/host/static/site.css", "body { color: red; }");
afterAll(() => folder.cleanup());

const serve = hostFilesFetch(() => folder.root);
const get = (path: string, method = "GET") =>
  serve(new Request(`http://127.0.0.1${path}`, { method })) ?? Promise.resolve(null);

describe("hostFilesFetch", () => {
  test("serves the design's stored copy by the app's path, sandboxed", async () => {
    const response = await get(`${HOST_FILES_PREFIX}/static/site.css`);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/css");
    expect(response?.headers.get("content-security-policy")).toContain("sandbox");
    expect(await response?.text()).toBe("body { color: red; }");
  });

  test("a file the design keeps no copy of is a 404 that says how to get one", async () => {
    const response = await get(`${HOST_FILES_PREFIX}/static/missing.css`);
    expect(response?.status).toBe(404);
    expect(await response?.text()).toContain("store_host_files");
  });

  test("never climbs out of the stored copies, and only reads", async () => {
    expect(
      (await get(`${HOST_FILES_PREFIX}/static/..%2f..%2f..%2f.design%2fconfig.json`))?.status,
    ).toBe(404);
    expect((await get(`${HOST_FILES_PREFIX}/static/site.css`, "POST"))?.status).toBe(405);
  });

  test("passes on anything outside its prefix", async () => {
    expect(serve(new Request("http://127.0.0.1/api/design"))).toBeNull();
  });
});

test("hostAssetRequest re-addresses only a design document's root-relative GETs", () => {
  const from = (referer: string, method = "GET") =>
    hostAssetRequest(
      new Request("http://127.0.0.1:7300/static/logo.png", { method, headers: { referer } }),
    );
  expect(new URL(from("http://127.0.0.1:7300/api/render/home")?.url ?? "").pathname).toBe(
    `${HOST_FILES_PREFIX}/static/logo.png`,
  );
  expect(from("http://127.0.0.1:7300/")).toBeNull();
  expect(from("http://127.0.0.1:7300/api/render/home", "POST")).toBeNull();
});
