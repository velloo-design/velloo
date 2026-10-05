import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCloudHealth } from "../cloud.ts";
import { uploadLinkBundle } from "../cloud-upload.ts";
import { withLocalReceiver, writeBundle } from "../publish/local-bundle.ts";

/**
 * `velloo publish --to <dir>` is the real publish, received in-process. The
 * receiver has to answer the calls publish makes the way the cloud does, or
 * the bundle on disk is not the one a share link would hold.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "velloo-local-bundle-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the local bundle receiver", () => {
  test("passes the health gate and keeps every file of the upload, by its path", async () => {
    const { result, files } = await withLocalReceiver(async (cloud) => {
      expect((await checkCloudHealth(cloud.baseUrl)).status).toBe("ok");
      const form = new FormData();
      form.append("file", new File(['{"title":"x"}'], "design.json", { type: "application/json" }));
      form.append("file", new File([".a{}"], "app-1a2b.css", { type: "text/css" }));
      form.append("file", new File(["{}"], "frozen/9z.json", { type: "application/json" }));
      return uploadLinkBundle({
        baseUrl: cloud.baseUrl,
        token: cloud.token,
        link: { folderId: "f", publishMode: "new", title: "x", visibility: "public" },
        form,
      });
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.files).toBe(3);
    expect([...files.keys()].sort()).toEqual(["app-1a2b.css", "design.json", "frozen/9z.json"]);

    await writeBundle(dir, files);
    expect(await readFile(join(dir, "frozen/9z.json"), "utf8")).toBe("{}");
    expect(await readFile(join(dir, "design.json"), "utf8")).toBe('{"title":"x"}');
  });

  test("never writes outside the directory it was given", async () => {
    const files = new Map([["../escaped.txt", new TextEncoder().encode("x")]]);
    await expect(writeBundle(dir, files)).rejects.toThrow("outside");
  });
});
