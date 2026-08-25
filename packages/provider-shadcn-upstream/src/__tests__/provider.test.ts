import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@velloo/provider";
import { createProvider } from "../index.ts";

/**
 * The upstream provider:
 *
 *   1. The factory returns a ComponentProvider with id "shadcn-upstream",
 *      reusing the snapshot's registry.
 *   2. The provider's `loadManifest` reads from a per-cache manifest.json
 *      when present; falls back to the snapshot manifest when missing.
 */

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-upstream-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("createProvider", () => {
  test("returns the shadcn-upstream identity with the snapshot registry", () => {
    const provider = createProvider();
    expect(provider.id).toBe("shadcn-upstream");
    expect(provider.registry.Button).toBeDefined();
    expect(provider.registry.Dialog).toBeDefined();
    // The snapshot's velloo helpers are also surfaced, so designs using
    // Heading/Text/etc. work against this provider unchanged.
    expect(provider.registry.Heading).toBeDefined();
  });

  test("loadManifest falls back to the snapshot manifest when no cache is provided", async () => {
    const provider = createProvider();
    const manifest = await provider.loadManifest();
    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest.find((c) => c.id === "Button")).toBeDefined();
  });

  test("loadManifest prefers a per-cache manifest.json when present", async () => {
    await mkdir(tmp, { recursive: true });
    const customManifest: Manifest = [
      {
        id: "CustomThing",
        category: "ui",
        source: "shadcn",
        props: [],
      },
    ];
    await writeFile(join(tmp, "manifest.json"), JSON.stringify(customManifest));
    const provider = createProvider({ cacheDir: tmp });
    const manifest = await provider.loadManifest();
    expect(manifest.length).toBe(1);
    expect(manifest[0]?.id).toBe("CustomThing");
  });
});
