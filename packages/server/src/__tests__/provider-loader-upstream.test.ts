import { describe, expect, test } from "bun:test";
import type { Library } from "@velloo/schema";
import { createServerProviderLoader } from "../providers.ts";

/**
 * Sprint Z: the loader knows about `shadcn-upstream` alongside the
 * legacy providers. Existing folders that still declare
 * `library.id: "shadcn-react"` resolve to the vendored snapshot
 * (back-compat). New folders that declare `shadcn-upstream` resolve
 * to the upstream provider.
 */

describe("createServerProviderLoader", () => {
  test("shadcn-react resolves to the vendored snapshot (back-compat)", async () => {
    const loader = createServerProviderLoader();
    const library: Library = {
      id: "shadcn-react",
      version: "2026.05.22",
      source: "binary",
      componentsPath: "binary",
    };
    const provider = await loader(library);
    expect(provider.id).toBe("shadcn-react");
  });

  test("shadcn-upstream resolves to the upstream provider", async () => {
    const loader = createServerProviderLoader();
    const library: Library = {
      id: "shadcn-upstream",
      version: "2026.05.26",
      source: "binary",
      componentsPath: "binary",
    };
    const provider = await loader(library);
    expect(provider.id).toBe("shadcn-upstream");
    expect(provider.version).toBe("2026.05.26");
  });

  test("shadcn-upstream survives a non-existent cache path (binary fallback)", async () => {
    const loader = createServerProviderLoader("/tmp/folder-that-doesnt-exist");
    const library: Library = {
      id: "shadcn-upstream",
      version: "2026.05.26",
      source: "cache",
      componentsPath: "~/.velloo/providers/shadcn-upstream@nope",
    };
    const provider = await loader(library);
    expect(provider.id).toBe("shadcn-upstream");
    // No throw; the provider falls back to the snapshot's componentsDir.
  });

  test("none and mui still resolve unchanged", async () => {
    const loader = createServerProviderLoader();
    const none = await loader({
      id: "none",
      version: "0.1.0",
      source: "binary",
      componentsPath: "binary",
    });
    expect(none.id).toBe("none");
    // MUI is scaffold-only — calling its factory throws a helpful error.
    await expect(
      loader({
        id: "mui",
        version: "6.0.0",
        source: "cache",
        componentsPath: "~/.velloo/providers/mui",
      }),
    ).rejects.toThrow(/not yet vendored/);
  });
});
