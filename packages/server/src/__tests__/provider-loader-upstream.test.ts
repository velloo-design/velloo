import { describe, expect, test } from "bun:test";
import type { Library } from "@velloo/schema";
import { createServerProviderLoader } from "../providers.ts";

/**
 * The loader resolves the schema-v2 library ids: `shadcn-upstream`
 * (rendering from the bundled snapshot registry), `none`, and `mui`.
 * The retired `shadcn-react` id no longer resolves — pre-v2 folders
 * go through `velloo upgrade` before they reach the loader.
 */

describe("createServerProviderLoader", () => {
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

  test("none and mui resolve to real adapters", async () => {
    const loader = createServerProviderLoader();
    const none = await loader({
      id: "none",
      version: "0.1.0",
      source: "binary",
      componentsPath: "binary",
    });
    expect(none.id).toBe("none");
    // MUI is now a first-class adapter (framework-native migration), not a throw.
    const mui = await loader({
      id: "mui",
      version: "6",
      source: "cache",
      componentsPath: "~/.velloo/providers/mui",
    });
    expect(mui.id).toBe("mui");
    expect(Object.keys(mui.registry).length).toBeGreaterThan(0);
  });
});
