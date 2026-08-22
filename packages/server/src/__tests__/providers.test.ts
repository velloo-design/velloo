import { describe, expect, test } from "bun:test";
import { type ComponentProvider, createProviderLoader } from "@velloo/provider";
import type { Config, Library } from "@velloo/schema";
import {
  DEFAULT_LEGACY_LIBRARY_ID,
  migrateConfig,
  migrateLibrarySource,
  resolveProviders,
} from "../providers.ts";

function lib(over: Partial<Library> = {}): Library {
  return {
    id: "shadcn-react",
    version: "test",
    source: "binary",
    componentsPath: "binary",
    ...over,
  };
}

function fakeProvider(id: string): ComponentProvider {
  return {
    id,
    version: "test",
    componentsDir: "/dev/null",
    styleEntryPath: "/dev/null",
    registry: {},
    loadManifest: async () => [],
  };
}

function baseConfig(over: Partial<Config>): Config {
  return {
    schemaVersion: 1,
    toolVersion: "test",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    ...over,
  } as Config;
}

describe("migrateLibrarySource", () => {
  test("normalizes legacy embedded/registry sources to binary", () => {
    for (const source of ["embedded:shadcn", "registry:shadcn"]) {
      const migrated = migrateLibrarySource(lib({ source, componentsPath: source }));
      expect(migrated.source).toBe("binary");
      expect(migrated.componentsPath).toBe("binary");
    }
  });

  test("passes canonical sources through untouched", () => {
    const canonical = lib({ source: "cache", componentsPath: ".design/cache/components" });
    expect(migrateLibrarySource(canonical)).toEqual(canonical);
  });
});

describe("migrateConfig", () => {
  test("promotes a legacy single-library config to multi-library", () => {
    const migrated = migrateConfig(baseConfig({ library: lib({ source: "embedded:shadcn" }) }));
    expect(migrated.library).toBeUndefined();
    expect(migrated.defaultLibrary).toBe(DEFAULT_LEGACY_LIBRARY_ID);
    const entry = migrated.libraries?.[DEFAULT_LEGACY_LIBRARY_ID];
    expect(entry?.id).toBe("shadcn-react");
    // The legacy-source migration applies during promotion too.
    expect(entry?.source).toBe("binary");
  });

  test("is idempotent on an already-multi-library config", () => {
    const multi = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "main",
    });
    const once = migrateConfig(multi);
    expect(migrateConfig(once)).toEqual(once);
    expect(once.libraries?.main).toEqual(lib());
  });

  test("normalizes legacy sources inside an existing multi-library map", () => {
    const multi = baseConfig({
      libraries: { main: lib({ source: "registry:shadcn" }) },
      defaultLibrary: "main",
    });
    expect(migrateConfig(multi).libraries?.main?.source).toBe("binary");
  });

  test("throws a meaningful error when neither shape is present", () => {
    expect(() => migrateConfig(baseConfig({}))).toThrow(/neither `library`/);
  });
});

describe("resolveProviders", () => {
  test("resolves every library and the default through the loader", async () => {
    const loader = createProviderLoader({
      "shadcn-react": () => fakeProvider("shadcn-react"),
      none: () => fakeProvider("none"),
    });
    const config = baseConfig({
      libraries: { main: lib(), bare: lib({ id: "none" }) },
      defaultLibrary: "bare",
    });
    const { providers, defaultProvider } = await resolveProviders(config, "/tmp", loader);
    expect(Object.keys(providers).sort()).toEqual(["bare", "main"]);
    expect(defaultProvider.id).toBe("none");
  });

  test("unknown provider ids surface an upgrade hint naming the library", async () => {
    const loader = createProviderLoader({});
    const config = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "main",
    });
    await expect(resolveProviders(config, "/tmp", loader)).rejects.toThrow(
      /doesn't know how to load library "shadcn-react".*registered as "main"/,
    );
  });

  test("rejects an unmigrated config", async () => {
    const config = baseConfig({ library: lib() });
    await expect(resolveProviders(config, "/tmp")).rejects.toThrow(/migrateConfig/);
  });

  test("rejects a defaultLibrary that matches no registered library", async () => {
    const loader = createProviderLoader({ "shadcn-react": () => fakeProvider("shadcn-react") });
    const config = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "ghost",
    });
    await expect(resolveProviders(config, "/tmp", loader)).rejects.toThrow(/"ghost"/);
  });

  // A provider that supports the inline-`style` channel (the no-framework lib).
  function noneAdapter(id: string): ComponentProvider {
    return { ...fakeProvider(id), styleChannels: ["tailwind-classname", "style"] } as never;
  }

  test("accepts styling the default library supports (none + none)", async () => {
    const loader = createProviderLoader({ none: () => noneAdapter("none") });
    const config = baseConfig({
      libraries: { bare: lib({ id: "none" }) },
      defaultLibrary: "bare",
      styling: { framework: "none" },
    });
    const { defaultProvider } = await resolveProviders(config, "/tmp", loader);
    expect(defaultProvider.id).toBe("none");
  });

  test("rejects styling no registered library supports (shadcn + none)", async () => {
    const loader = createProviderLoader({ "shadcn-react": () => fakeProvider("shadcn-react") });
    const config = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "main",
      styling: { framework: "none" },
    });
    await expect(resolveProviders(config, "/tmp", loader)).rejects.toThrow(
      /"none" isn't supported by any registered library/,
    );
  });

  test("tailwind styling is universally accepted", async () => {
    const loader = createProviderLoader({ "shadcn-react": () => fakeProvider("shadcn-react") });
    const config = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "main",
      styling: { framework: "tailwind" },
    });
    const { defaultProvider } = await resolveProviders(config, "/tmp", loader);
    expect(defaultProvider.id).toBe("shadcn-react");
  });
});
