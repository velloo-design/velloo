import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitCode } from "@velloo/codegen";
import { unwrap } from "@velloo/result";
import type { Theme } from "@velloo/schema";
import { ConfigSchema } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { type DesignFolder, loadDesignFolder } from "../../../design-folder.ts";
import {
  addExtension,
  type MutationContext,
  removeExtension,
  updateExtension,
} from "../../../mutations/index.ts";
import { migrateConfig } from "../../../providers.ts";
import type { WatchEvent } from "../../../watcher.ts";

/**
 * End-to-end of the extension lifecycle exposed via the
 * `add_extension` / `update_extension` / `remove_extension` mutations.
 * Goes through the mutation layer (not the MCP HTTP path) so the test
 * is fast; the MCP tool wrappers are thin and exercised by the smoke
 * test indirectly.
 */

const sampleConfig = {
  schemaVersion: 1 as const,
  toolVersion: "0.1.0",
  library: {
    id: "shadcn-react" as const,
    version: "test",
    source: "binary",
    componentsPath: "binary",
  },
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme: Theme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

const sampleScreen = {
  id: "dashboard",
  name: "Dashboard",
  tree: { $ref: "Card", props: { className: "p-4" }, children: [] },
};

const shadcnProvider = createShadcnProvider();

let tmp: string;
let folder: DesignFolder;
let ctx: MutationContext;
let events: WatchEvent[];

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-ext-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, ".design"), { recursive: true });
  await mkdir(join(tmp, "theme"), { recursive: true });
  await mkdir(join(tmp, "screens"), { recursive: true });
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/dashboard.json"), sampleScreen);
  folder = await loadDesignFolder(tmp);
  folder.config = migrateConfig(folder.config);
  events = [];
  ctx = {
    folder,
    providers: { default: shadcnProvider },
    defaultProvider: shadcnProvider,
    provider: shadcnProvider,
    broadcast: (e) => events.push(e),
  };
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("extension lifecycle", () => {
  test("add_extension persists to config and broadcasts config-changed", async () => {
    const r = unwrap(
      await addExtension(ctx, {
        id: "DataTable",
        importPath: "@/components/data-table",
        props: [
          { name: "data", type: "any[]", optional: false, control: "string" },
          {
            name: "sortable",
            type: "boolean | undefined",
            optional: true,
            control: "boolean",
          },
        ],
        description: "Sortable table",
      }),
    );
    expect(r.id).toBe("DataTable");
    expect(r.extension.importPath).toBe("@/components/data-table");
    expect(r.extension.origin).toBe("agent");

    // Config on disk has the extension.
    const onDisk = ConfigSchema.parse(
      JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")),
    );
    expect(onDisk.extensions?.DataTable?.importPath).toBe("@/components/data-table");

    // Broadcasts.
    expect(events.some((e) => e.type === "config-changed")).toBe(true);
  });

  test("add_extension render:live persists the flag and warns on an unresolvable importPath", async () => {
    const r = unwrap(
      await addExtension(ctx, {
        id: "PriceChart",
        importPath: "@/components/charts/DoesNotExist",
        props: [],
        render: "live",
      }),
    );
    expect(r.extension.render).toBe("live");
    // The tmp folder has no host app with this component, so the agent gets a
    // first-class warning rather than a silently-broken live preview.
    expect(r.liveResolveWarning).toBeDefined();

    const onDisk = ConfigSchema.parse(
      JSON.parse(await readFile(join(tmp, ".design/config.json"), "utf8")),
    );
    expect(onDisk.extensions?.PriceChart?.render).toBe("live");
  });

  test("update_extension can flip render to live", async () => {
    unwrap(await addExtension(ctx, { id: "Chart2", importPath: "@/c", props: [] }));
    const r = unwrap(await updateExtension(ctx, { id: "Chart2", patch: { render: "live" } }));
    expect(r.extension.render).toBe("live");
  });

  test("add_extension returns shadowedLibraryComponent when the id matches a library component", async () => {
    const r = unwrap(
      await addExtension(ctx, {
        id: "Button",
        importPath: "@/components/custom-button",
        props: [],
      }),
    );
    expect(r.shadowedLibraryComponent).toBe("Button");
  });

  test("add_extension refuses a duplicate id", async () => {
    unwrap(
      await addExtension(ctx, {
        id: "Hero",
        importPath: "@/components/hero",
        props: [],
      }),
    );
    const second = await addExtension(ctx, {
      id: "Hero",
      importPath: "@/other/hero",
      props: [],
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe("ExtensionIdConflict");
  });

  test("update_extension partial-patches a single field", async () => {
    unwrap(
      await addExtension(ctx, {
        id: "Chart",
        importPath: "@/components/chart",
        props: [{ name: "kind", type: "string", optional: false, control: "string" }],
        description: "Old description",
      }),
    );
    const r = unwrap(
      await updateExtension(ctx, {
        id: "Chart",
        patch: { description: "New description" },
      }),
    );
    expect(r.extension.description).toBe("New description");
    expect(r.extension.importPath).toBe("@/components/chart");
    expect(r.extension.props.length).toBe(1);
  });

  test("update_extension on unknown id returns ExtensionNotFound", async () => {
    const r = await updateExtension(ctx, {
      id: "Nope",
      patch: { description: "x" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("ExtensionNotFound");
  });

  test("remove_extension drops the entry when not referenced", async () => {
    unwrap(
      await addExtension(ctx, {
        id: "Map",
        importPath: "@/components/map",
        props: [],
      }),
    );
    const r = unwrap(await removeExtension(ctx, { id: "Map" }));
    expect(r.id).toBe("Map");
    expect(folder.config.extensions?.Map).toBeUndefined();
  });

  test("remove_extension refuses when the extension is referenced by a screen", async () => {
    unwrap(
      await addExtension(ctx, {
        id: "DataTable",
        importPath: "@/components/data-table",
        props: [],
      }),
    );
    // Hand-edit the screen to reference the extension. (Going through
    // addNode would also work but requires the ensureKnownComponent
    // wiring — we test removal precondition here.)
    const screen = folder.screens.get("dashboard");
    if (!screen) throw new Error("seeded screen missing");
    screen.tree = { $ref: "DataTable", props: { data: [], sortable: true } };

    const r = await removeExtension(ctx, { id: "DataTable" });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "ExtensionInUse") {
      expect(r.error.references.length).toBeGreaterThan(0);
      expect(r.error.references[0]?.screenId).toBe("dashboard");
    } else {
      throw new Error(`expected ExtensionInUse, got ${r.ok ? "ok" : r.error.kind}`);
    }
  });
});

describe("codegen with extensions", () => {
  test("emit_code emits a bare import for an extension $ref", async () => {
    unwrap(
      await addExtension(ctx, {
        id: "DataTable",
        importPath: "@/components/data-table",
        props: [{ name: "data", type: "any[]", optional: false, control: "string" }],
      }),
    );
    const screen = folder.screens.get("dashboard");
    if (!screen) throw new Error("seeded screen missing");
    screen.tree = {
      $ref: "Card",
      children: [{ $ref: "DataTable", props: { data: [] } }],
    };

    const ir = unwrap(await emitCode(screen, { extensions: folder.config.extensions }));
    expect(ir.componentsUsed).toContain("DataTable");
    expect(ir.jsx).toContain("<DataTable");
  });
});
