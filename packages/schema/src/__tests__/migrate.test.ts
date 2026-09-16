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

describe("planMigration 2 → 3", () => {
  const v2Theme = {
    name: "Wren & Field",
    colors: { background: "#fff" },
    typography: {
      fontFamily: {
        sans: '"Karla", sans-serif',
        mono: "ui-monospace, monospace",
        display: '"Fraunces", serif',
      },
      googleFonts: ["Fraunces:wght@300..600"],
      fontSize: { xs: 12, sm: 14, base: 16, lg: 18, "4xl": 36 },
      fontWeight: { normal: 400, bold: 700 },
      lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
      letterSpacing: { tight: "-0.02em" },
    },
  };

  /** Migrate one theme document through the whole chain from v2. */
  function migrateTheme(theme: Record<string, unknown>) {
    const run = planMigration({ schemaVersion: 2 });
    const out = run.theme(theme) as { typography: Record<string, unknown> };
    return out.typography;
  }

  test("drops every record the typeset replaced", () => {
    const typography = migrateTheme(v2Theme);
    expect(typography.fontSize).toBeUndefined();
    expect(typography.fontWeight).toBeUndefined();
    expect(typography.lineHeight).toBeUndefined();
    expect(typography.letterSpacing).toBeUndefined();
    // Everything the typeset did NOT replace survives untouched.
    expect(typography.fontFamily).toEqual(v2Theme.typography.fontFamily);
    expect(typography.googleFonts).toEqual(v2Theme.typography.googleFonts);
  });

  test("binds the font roles so a migrated folder keeps its own faces", () => {
    const typesets = migrateTheme(v2Theme).typesets as { default: Record<string, unknown> };
    expect(typesets.default.fontBody).toBe("sans");
    expect(typesets.default.fontHeading).toBe("display");
    expect(typesets.default.fontMono).toBe("mono");
  });

  test("carries body leading over and leaves the base size container-relative", () => {
    const typesets = migrateTheme(v2Theme).typesets as { default: Record<string, unknown> };
    expect(typesets.default.leading).toBe(1.5);
    // base was the implied 16, so `size` stays unset rather than pinning to px.
    expect(typesets.default.size).toBeUndefined();
  });

  test("preserves a base size that was actually tuned", () => {
    const theme = {
      typography: { ...v2Theme.typography, fontSize: { base: 15 } },
    };
    const typesets = migrateTheme(theme).typesets as { default: Record<string, unknown> };
    expect(typesets.default.size).toBe(15);
  });

  test("leaves a hand-authored default typeset alone", () => {
    const authored = { leading: 1.9, fontBody: "body" };
    const theme = {
      typography: { ...v2Theme.typography, typesets: { default: authored, docs: { flow: 20 } } },
    };
    const typesets = migrateTheme(theme).typesets as Record<string, unknown>;
    expect(typesets.default).toEqual(authored);
    expect(typesets.docs).toEqual({ flow: 20 });
  });

  test("emits no typesets when there was nothing to read", () => {
    expect(migrateTheme({ typography: {} }).typesets).toBeUndefined();
  });

  test("a theme with no typography block passes through", () => {
    const theme = { name: "Bare", colors: {} };
    expect(planMigration({ schemaVersion: 2 }).theme(theme)).toEqual(theme);
  });

  test("a v1 folder gets the typeset step too, not just the library one", () => {
    const run = planMigration(legacyConfig);
    expect(run.applied).toHaveLength(3);
    const typography = (run.theme(v2Theme) as { typography: Record<string, unknown> }).typography;
    expect(typography.fontSize).toBeUndefined();
    expect(typography.typesets).toBeDefined();
  });

  test("migrating a theme twice equals migrating it once", () => {
    const once = planMigration({ schemaVersion: 2 }).theme(v2Theme);
    const twice = planMigration({ schemaVersion: 2 }).theme(once as Record<string, unknown>);
    expect(twice).toEqual(once);
  });
});

describe("planMigration 3 → 4", () => {
  test("the registration's name moves into the config", () => {
    const run = planMigration({ schemaVersion: 3 }, { name: "web" });
    expect(run.config.name).toBe("web");
    expect(run.config.schemaVersion).toBe(4);
  });

  test("an existing valid name is kept; none at all falls back", () => {
    expect(planMigration({ schemaVersion: 3, name: "kept" }, { name: "web" }).config.name).toBe(
      "kept",
    );
    expect(planMigration({ schemaVersion: 3 }).config.name).toBe("design");
  });

  test("project: paths become app: paths everywhere a config holds one", () => {
    const run = planMigration({
      schemaVersion: 3,
      hostApp: { root: "project:." },
      hostApps: { admin: { root: "project:apps/admin" }, web: { root: "../web" } },
      libraries: { default: { id: "none", componentsPath: "project:src/ui" } },
    });
    expect(run.config.hostApp).toEqual({ root: "app:." });
    expect(run.config.hostApps).toEqual({
      admin: { root: "app:apps/admin" },
      web: { root: "../web" },
    });
    expect(
      (run.config.libraries as Record<string, { componentsPath: string }>).default?.componentsPath,
    ).toBe("app:src/ui");
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
