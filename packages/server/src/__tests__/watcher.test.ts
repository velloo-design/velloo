import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WatchEvent, type Watcher, watchDesignFolder } from "../watcher.ts";

let tmp: string;
let watcher: Watcher | null = null;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, "pages"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
});

afterEach(async () => {
  watcher?.close();
  watcher = null;
  await rm(tmp, { recursive: true, force: true });
});

function nextEvent(): Promise<WatchEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout waiting for watch event")), 2000);
    watcher = watchDesignFolder(
      tmp,
      (e) => {
        clearTimeout(timeout);
        resolve(e);
      },
      10,
    );
  });
}

describe("watchDesignFolder", () => {
  test("emits page-changed for pages/<id>.json", async () => {
    const p = nextEvent();
    // Give the watcher a beat to register before mutating.
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmp, "pages", "onboarding.json"), "{}", "utf8");
    const ev = await p;
    expect(ev.type).toBe("page-changed");
    if (ev.type === "page-changed") expect(ev.pageId).toBe("onboarding");
  });

  test("emits theme-changed for theme/default.json", async () => {
    const p = nextEvent();
    await new Promise((r) => setTimeout(r, 50));
    await writeFile(join(tmp, "theme", "default.json"), "{}", "utf8");
    const ev = await p;
    expect(ev.type).toBe("theme-changed");
  });
});
