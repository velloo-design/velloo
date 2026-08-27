import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, planMigration, schemaVersionOf } from "../migrate.ts";

const legacyConfig = {
  schemaVersion: 1,
  toolVersion: "0.0.1 (test)",
  library: {
    id: "shadcn-react",
    version: "2026.05.22",
    source: "embedded:shadcn",
    componentsPath: "components",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

describe("schemaVersionOf", () => {
  test("reads a valid version", () => {
    expect(schemaVersionOf({ schemaVersion: 2 })).toBe(2);
  });

  test("treats absent/malformed as version 1", () => {
    expect(schemaVersionOf({})).toBe(1);
    expect(schemaVersionOf({ schemaVersion: "1" })).toBe(1);
    expect(schemaVersionOf(null)).toBe(1);
    expect(schemaVersionOf(undefined)).toBe(1);
  });
});

describe("planMigration 1 → 2", () => {
  test("promotes the legacy single-library shape", () => {
    const run = planMigration(legacyConfig);
    expect(run.applied).toHaveLength(1);
    expect(run.config.library).toBeUndefined();
    expect(run.config.defaultLibrary).toBe("default");
    const libs = run.config.libraries as Record<string, Record<string, unknown>>;
    expect(Object.keys(libs)).toEqual(["default"]);
  });

  test("normalizes legacy source aliases to binary", () => {
    const run = planMigration(legacyConfig);
    const lib = (run.config.libraries as { default: Record<string, unknown> }).default;
    expect(lib.source).toBe("binary");
    expect(lib.componentsPath).toBe("binary");
  });

  test("retires shadcn-react in favor of shadcn-upstream", () => {
    const run = planMigration(legacyConfig);
    const lib = (run.config.libraries as { default: Record<string, unknown> }).default;
    expect(lib.id).toBe("shadcn-upstream");
    expect(lib.version).toBe("2026.05.22");
  });

  test("migrates entries inside an existing multi-library map too", () => {
    const run = planMigration({
      schemaVersion: 1,
      libraries: {
        main: { id: "shadcn-react", version: "1", source: "registry:shadcn", componentsPath: "x" },
        extra: { id: "mui", version: "6", source: "cache", componentsPath: "~/.velloo/mui" },
      },
      defaultLibrary: "main",
    });
    const libs = run.config.libraries as {
      main: Record<string, unknown>;
      extra: Record<string, unknown>;
    };
    expect(libs.main.id).toBe("shadcn-upstream");
    expect(libs.main.source).toBe("binary");
    expect(libs.extra).toEqual({
      id: "mui",
      version: "6",
      source: "cache",
      componentsPath: "~/.velloo/mui",
    });
    expect(run.config.defaultLibrary).toBe("main");
  });

  test("stamps author on annotations that predate the field", () => {
    const run = planMigration(legacyConfig);
    expect(run.annotation({ id: "a1", body: "hi" })).toEqual({
      id: "a1",
      body: "hi",
      author: "user",
    });
    expect(run.annotation({ id: "a2", body: "hi", author: "agent" }).author).toBe("agent");
  });

  test("stamps the current schema version", () => {
    expect(planMigration(legacyConfig).config.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
});

describe("planMigration idempotency + guards", () => {
  test("a current config passes through with no steps", () => {
    const current = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      libraries: { default: { id: "mui", version: "6", source: "binary", componentsPath: "b" } },
      defaultLibrary: "default",
    };
    const run = planMigration(current);
    expect(run.applied).toEqual([]);
    expect(run.config).toEqual(current);
    expect(run.annotation({ id: "a", body: "x", author: "user" })).toEqual({
      id: "a",
      body: "x",
      author: "user",
    });
  });

  test("migrating twice equals migrating once", () => {
    const once = planMigration(legacyConfig).config;
    const twice = planMigration(once).config;
    expect(twice).toEqual(once);
  });

  test("a future version throws an upgrade-velloo error", () => {
    expect(() => planMigration({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(
      /newer than this velloo/,
    );
  });
});
