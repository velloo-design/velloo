import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "@velloo/provider";
import { createProvider, installShadcnUpstream } from "../index.ts";

/**
 * End-to-end of the Sprint-Z upstream provider:
 *
 *   1. The factory returns a ComponentProvider with id "shadcn-upstream",
 *      reusing the snapshot's registry (Sprint Z scope note).
 *   2. The provider's `loadManifest` reads from a per-cache manifest.json
 *      when present; falls back to the snapshot manifest when missing.
 *   3. `installShadcnUpstream` fetches + writes + manifests; the provider
 *      built from that cache picks up the fetched manifest.
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

describe("installShadcnUpstream", () => {
  test("end-to-end install + provider load surfaces fetched manifest", async () => {
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/badge.json")) {
        return new Response(
          JSON.stringify({
            name: "badge",
            files: [
              {
                path: "ui/badge.tsx",
                content: `import * as React from "react"
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "destructive"
}
export function Badge({ variant, ...props }: BadgeProps) {
  return <span data-variant={variant} {...props} />
}
`,
              },
            ],
            dependencies: [],
          }),
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await installShadcnUpstream({
      destination: tmp,
      components: ["badge"],
      fetchImpl,
    });
    expect(result.destination).toBe(tmp);
    expect(result.lock.components.badge).toBeDefined();
    // lib/utils.ts ships with every install, so cn()'s imports are
    // always part of the aggregate even when components declare none.
    expect(result.npmDependencies).toEqual(["clsx", "tailwind-merge"]);

    // Provider built from this cache sees the fetched-manifest Badge entry.
    const provider = createProvider({ cacheDir: tmp });
    const manifest = await provider.loadManifest();
    const badge = manifest.find((c) => c.id === "Badge");
    expect(badge).toBeDefined();
    expect(badge?.source).toBe("shadcn");
    const variant = badge?.props.find((p) => p.name === "variant");
    expect(variant?.control).toBe("enum");
    expect(variant?.enumValues).toContain("default");
    expect(variant?.enumValues).toContain("destructive");
  });
});
