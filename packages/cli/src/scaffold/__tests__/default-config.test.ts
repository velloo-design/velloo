import { describe, expect, test } from "bun:test";
import { ConfigSchema } from "@velloo/schema";
import { buildDefaultConfig } from "../default-config.ts";

describe("buildDefaultConfig — styling axis", () => {
  test("omits styling by default (library default channel)", () => {
    const config = buildDefaultConfig();
    expect(config.styling).toBeUndefined();
    expect(ConfigSchema.parse(config)).toBeTruthy();
  });

  test("carries a none/none folder's CSS framework through", () => {
    const config = buildDefaultConfig({
      library: { id: "none", version: "0.1.0", source: "binary", componentsPath: "binary" },
      styling: { framework: "none" },
    });
    expect(config.styling).toEqual({ framework: "none" });
    expect(ConfigSchema.parse(config)).toBeTruthy();
  });

  test("carries a none/tailwind folder's CSS framework through", () => {
    const config = buildDefaultConfig({ styling: { framework: "tailwind" } });
    expect(config.styling).toEqual({ framework: "tailwind" });
    expect(ConfigSchema.parse(config)).toBeTruthy();
  });
});
