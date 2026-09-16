import { describe, expect, test } from "bun:test";
import { type ComponentProvider, createProviderLoader } from "@velloo/provider";
import type { Config, Library } from "@velloo/schema";
import { resolveProviders } from "../providers.ts";

function lib(over: Partial<Library> = {}): Library {
  return {
    id: "shadcn-upstream",
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
    schemaVersion: 4,
    name: "test",
    toolVersion: "test",
    viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
    ...over,
  } as Config;
}

describe("resolveProviders", () => {
  test("resolves every library and the default through the loader", async () => {
    const loader = createProviderLoader({
      "shadcn-upstream": () => fakeProvider("shadcn-upstream"),
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
      /doesn't know how to load library "shadcn-upstream".*registered as "main"/,
    );
  });

  test("rejects a defaultLibrary that matches no registered library", async () => {
    const loader = createProviderLoader({
      "shadcn-upstream": () => fakeProvider("shadcn-upstream"),
    });
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
    const loader = createProviderLoader({
      "shadcn-upstream": () => fakeProvider("shadcn-upstream"),
    });
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
    const loader = createProviderLoader({
      "shadcn-upstream": () => fakeProvider("shadcn-upstream"),
    });
    const config = baseConfig({
      libraries: { main: lib() },
      defaultLibrary: "main",
      styling: { framework: "tailwind" },
    });
    const { defaultProvider } = await resolveProviders(config, "/tmp", loader);
    expect(defaultProvider.id).toBe("shadcn-upstream");
  });
});
