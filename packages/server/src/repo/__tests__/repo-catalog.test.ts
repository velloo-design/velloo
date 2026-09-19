import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Config } from "@velloo/schema";
import { RepoComponents } from "../catalog.ts";
import { discoverRepoComponents } from "../discover.ts";
import { parseLiteral } from "../literal.ts";
import { scanModule } from "../source-scan.ts";
import { suggestPreviewEntry } from "../suggest-preview.ts";

const FIXTURE = resolve(import.meta.dir, "../../__tests__/fixtures/repo-custom");

describe("scanModule", () => {
  test("reads imports, re-exports, exports and JSX without running anything", () => {
    const scan = scanModule(`
      import "./global.css";
      import React, { useState as useS, type FC } from "react";
      import * as UI from "@acme/ui";
      export { Card } from "./card";
      export * from "./rest";
      // <Commented /> tags don't count, and neither does useState<Props>()
      export default function Page() {
        const [x] = useS<Props>(0);
        return <UI.Button size="sm" disabled onClick={() => x}>Go</UI.Button>;
      }
    `);
    expect(scan.imports.map((i) => i.specifier)).toEqual(["react", "@acme/ui", "./global.css"]);
    expect(scan.imports[0]?.bindings).toEqual([
      { local: "React", imported: "default" },
      { local: "useS", imported: "useState" },
    ]);
    expect(scan.reExports.map((r) => r.specifier)).toEqual(["./card", "./rest"]);
    expect(scan.componentExports).toEqual(["default"]);
    expect(scan.elements).toEqual([
      expect.objectContaining({
        tag: "UI.Button",
        text: "Go",
        attributes: [
          { name: "size", value: "sm" },
          { name: "disabled", value: true },
          { name: "onClick", expression: "() => x" },
        ],
      }),
    ]);
  });

  test("flags server-only modules", () => {
    expect(scanModule('"use server";\nexport const x = 1;').serverOnly).toBe(true);
    expect(scanModule('import "server-only";').serverOnly).toBe(true);
    expect(scanModule("export const x = 1;").serverOnly).toBe(false);
  });
});

describe("parseLiteral", () => {
  test("accepts data and refuses code", () => {
    expect(parseLiteral("{ a: 'x', b: [1, -2.5, true, null], 'c-d': { e: `f` }, }")).toEqual({
      ok: true,
      value: { a: "x", b: [1, -2.5, true, null], "c-d": { e: "f" } },
    });
    expect(parseLiteral("() => 1").ok).toBe(false);
    // A template with a substitution is code, even though it looks like a string.
    expect(parseLiteral(["`a$", "{b}`"].join("")).ok).toBe(false);
    expect(parseLiteral("value").ok).toBe(false);
  });
});

describe("discoverRepoComponents on a custom component system", () => {
  test("finds what the app renders, through barrels, defaults and compound parts", async () => {
    const result = await discoverRepoComponents({
      hostRoot: FIXTURE,
      aliases: [{ from: "@/", to: "src/" }],
    });
    const names = result.components.map((c) => c.name).sort();
    expect(names).toEqual([
      "App",
      "Badge",
      "Broken",
      "Hero",
      "Panel",
      "Panel.Header",
      "StatCard",
      "Steps",
      "Steps.Step",
      "ThemedButton",
    ]);
    // Exported by the barrel but rendered nowhere.
    expect(names).not.toContain("Unused");

    const statCard = result.components.find((c) => c.name === "StatCard");
    // Kept exactly as the app imports it: through the barrel, root-relative.
    expect(statCard?.identity).toEqual({ importPath: "./src/components", exportName: "StatCard" });
    expect(statCard?.usages[0]).toMatchObject({
      at: "src/App.jsx:11",
      props: { label: "Uptime", value: "99.9%", tone: "positive" },
    });
    expect(result.components.find((c) => c.name === "Hero")?.identity).toEqual({
      importPath: "./src/components/hero",
      exportName: "default",
    });
    expect(result.components.find((c) => c.name === "Panel.Header")?.identity).toEqual({
      importPath: "./src/components",
      exportName: "Panel",
      member: "Header",
    });

    expect(result.wrappers.map((w) => w.name)).toEqual(["ThemeProvider"]);
    expect(result.globalStyles).toEqual([{ specifier: "./styles.css", at: "src/main.jsx:1" }]);
    expect(result.skipped).toEqual([{ file: "src/server/report.ts", reason: "server-only" }]);
  });

  test("configured include roots add components no route renders yet", async () => {
    const result = await discoverRepoComponents({
      hostRoot: FIXTURE,
      aliases: [],
      include: ["src/components/unused.tsx"],
    });
    expect(result.components.find((c) => c.name === "Unused")?.identity).toEqual({
      importPath: "./src/components/unused",
      exportName: "Unused",
    });
  });

  test("exclude and owned modules leave components out", async () => {
    const result = await discoverRepoComponents({
      hostRoot: FIXTURE,
      aliases: [],
      exclude: ["./components/theme"],
      owned: (_specifier, resolved) => resolved?.endsWith("badge.tsx") === true,
    });
    const names = result.components.map((c) => c.name);
    expect(names).not.toContain("ThemedButton");
    // Owned by the barrel's re-export, the Badge import still resolves to the
    // barrel — so ownership is judged on the file the app imports.
    expect(names).toContain("StatCard");
  });

  test("what an owned file renders internally is not the app's", async () => {
    const root = realpathSync(await mkdtemp(join(tmpdir(), "velloo-owned-")));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { react: "*", "@radix-ui/react-slot": "*" } }),
      );
      await mkdir(join(root, "src/ui"), { recursive: true });
      await writeFile(
        join(root, "src/ui/button.tsx"),
        'import { Slot } from "@radix-ui/react-slot";\nexport function Button() {\n  return <Slot />;\n}\n',
      );
      await writeFile(
        join(root, "src/main.tsx"),
        'import { Button } from "./ui/button";\nimport { Slot, MAX } from "@radix-ui/react-slot";\nexport default function App() {\n  return <Slot><Button size={MAX} /></Slot>;\n}\n',
      );
      const result = await discoverRepoComponents({
        hostRoot: root,
        aliases: [],
        owned: (_specifier, resolved) => resolved?.startsWith(join(root, "src/ui")) === true,
      });
      const slot = result.components.find((c) => c.name === "Slot");
      // `size={MAX}` passes a constant, not a component.
      expect(result.components.map((c) => c.name)).toEqual(["Slot"]);
      // Only the app's own use counts, not the owned button's.
      expect(slot?.usages.map((u) => u.at)).toEqual(["src/main.tsx:4"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("RepoComponents catalog", () => {
  let folder: string;
  let host: string;
  const config = (): Config => ({ hostApp: { root: host } }) as unknown as Config;

  beforeAll(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "velloo-repo-catalog-"));
    host = join(tmp, "app");
    await cp(FIXTURE, host, { recursive: true });
    folder = join(host, "velloo");
  });
  afterAll(async () => {
    await rm(join(host, ".."), { recursive: true, force: true });
  });

  test("extracts props, children, parts and preview states", async () => {
    const repo = new RepoComponents({ folderRoot: folder, config, reservedIds: () => new Set() });
    const catalog = await repo.catalog();
    const statCard = catalog.byId.get("StatCard");
    expect(statCard?.props.find((p) => p.name === "tone")).toMatchObject({
      control: "enum",
      enumValues: ["positive", "negative", "neutral"],
      defaultValue: "neutral",
      description: "Colors the value.",
    });
    expect(statCard?.props.find((p) => p.name === "onSelect")).toMatchObject({
      serializable: false,
    });
    expect(statCard?.styleProps).toEqual(["className"]);
    // Stories first (args merged over the meta's; code args are named, not run),
    // then the app's own call sites.
    expect(statCard?.states.map((s) => [s.name, s.source])).toEqual([
      ["Positive", "story"],
      ["With Handler", "story"],
      ["As used at src/App.jsx:11", "usage"],
    ]);
    expect(statCard?.states[0]?.props).toEqual({
      label: "Revenue",
      value: "$12k",
      tone: "positive",
    });
    expect(statCard?.states[1]?.dropped).toEqual(["onSelect"]);
    expect(catalog.byId.get("Panel")?.parts).toEqual(["Header"]);
    expect(catalog.byId.get("Panel")?.acceptsChildren).toBe(true);
    expect(catalog.byId.get("Badge")?.states[0]?.props).toEqual({
      variant: "outline",
      children: "Healthy",
    });
  });

  test("a name the provider already uses gets a visibly qualified id", async () => {
    const repo = new RepoComponents({
      folderRoot: folder,
      config,
      reservedIds: () => new Set(["Badge", "Panel"]),
    });
    const catalog = await repo.catalog();
    expect(catalog.byId.has("Badge")).toBe(false);
    expect(catalog.byId.get("App.Badge")?.qualifiedBecause).toContain("provider");
    expect(catalog.byId.get("App.Panel.Header")?.identity.member).toBe("Header");
    expect(catalog.byId.get("StatCard")?.qualifiedBecause).toBeUndefined();
  });

  test("two modules exporting one name get ids that tell them apart", async () => {
    const root = realpathSync(await mkdtemp(join(tmpdir(), "velloo-dupe-")));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { react: "*" } }));
      for (const [dir, prop] of [
        ["hud/fields", "min"],
        ["style-editor/controls", "unit"],
      ] as const) {
        await mkdir(join(root, "src", dirname(dir)), { recursive: true });
        await writeFile(
          join(root, "src", `${dir}.tsx`),
          `export function NumberField({ ${prop} }: { ${prop}: string }) {\n  return null;\n}\n`,
        );
      }
      await writeFile(
        join(root, "src/main.tsx"),
        'import { NumberField } from "./hud/fields";\nimport { NumberField as Num } from "./style-editor/controls";\nexport default function App() {\n  return <><NumberField /><Num /></>;\n}\n',
      );
      const repo = new RepoComponents({
        folderRoot: join(root, "velloo"),
        config: () => ({ hostApp: { root } }) as unknown as Config,
        reservedIds: () => new Set(),
      });
      const catalog = await repo.catalog();
      expect(catalog.entries.map((entry) => entry.id).sort()).toEqual([
        "Controls.NumberField",
        "Fields.NumberField",
      ]);
      expect(catalog.byId.get("Fields.NumberField")?.identity.importPath).toBe("./src/hud/fields");
      // Both declare \`NumberFieldProps\` in effect; each keeps its own.
      expect(catalog.byId.get("Fields.NumberField")?.props.map((p) => p.name)).toEqual(["min"]);
      expect(catalog.byId.get("Controls.NumberField")?.props.map((p) => p.name)).toEqual(["unit"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a name the app never writes resolves against a package it already uses", async () => {
    const root = realpathSync(await mkdtemp(join(tmpdir(), "velloo-icons-")));
    try {
      const pkg = join(root, "node_modules/@acme/icons");
      await mkdir(join(pkg, "dist"), { recursive: true });
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({ name: "@acme/icons", types: "dist/index.d.ts" }),
      );
      await writeFile(join(pkg, "dist/index.d.ts"), 'export * from "./icons";\n');
      await writeFile(
        join(pkg, "dist/icons.d.ts"),
        "interface IconProps { size?: number }\ndeclare const IconA: (p: IconProps) => null;\ndeclare const IconB: (p: IconProps) => null;\nexport { IconA, IconB };\n",
      );
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { react: "*", "@acme/icons": "*" } }),
      );
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/main.tsx"),
        'import { IconA } from "@acme/icons";\nexport default function App() {\n  return <IconA />;\n}\n',
      );
      const repo = new RepoComponents({
        folderRoot: join(root, "velloo"),
        config: () => ({ hostApp: { root } }) as unknown as Config,
        reservedIds: () => new Set(),
      });
      expect((await repo.catalog()).entries.map((entry) => entry.id)).toEqual(["IconA"]);
      expect((await repo.resolveName("IconB"))?.identity).toEqual({
        importPath: "@acme/icons",
        exportName: "IconB",
      });
      expect(await repo.resolveName("IconNope")).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("checked-in overrides refine entries and report what went stale", async () => {
    await writeFile(
      join(folder, "repo-components.json"),
      JSON.stringify({
        components: {
          "./src/components#StatCard": {
            description: "KPI tile",
            proxy: "stat-card-proxy",
            states: { Empty: { label: "Revenue", value: "—", bogus: 1 } },
          },
          "./src/components/broken#Broken": { exclude: true },
          "./src/components#Gone": { description: "renamed away" },
        },
      }),
    );
    const repo = new RepoComponents({ folderRoot: folder, config, reservedIds: () => new Set() });
    const catalog = await repo.catalog();
    const statCard = catalog.byId.get("StatCard");
    expect(statCard?.description).toBe("KPI tile");
    expect(statCard?.proxy).toBe("stat-card-proxy");
    expect(statCard?.states[0]?.name).toBe("Empty");
    expect(catalog.byId.has("Broken")).toBe(false);
    expect(catalog.warnings).toEqual([
      'repo-components.json: "./src/components#Gone" matches no discovered component',
      'repo-components.json: state "Empty" of ./src/components#StatCard sets unknown prop "bogus"',
    ]);
    await rm(join(folder, "repo-components.json"));
  });

  test("invalidates only for files it read, manifests, stories and previews", async () => {
    const repo = new RepoComponents({ folderRoot: folder, config, reservedIds: () => new Set() });
    await repo.catalog();
    expect(repo.invalidate([join(host, "README.md")])).toBe(false);
    expect(repo.invalidate([join(host, "src/components/unused.tsx")])).toBe(false);
    // Read through the barrel's re-export: its props come from here.
    expect(repo.invalidate([join(realpathSync(host), "src/components/stat-card.tsx")])).toBe(true);
    await repo.catalog();
    expect(repo.invalidate([join(realpathSync(host), "src/App.jsx")])).toBe(true);
    await repo.catalog();
    expect(repo.invalidate([join(host, "package.json")])).toBe(true);
  });

  test("resolves the app's own preview entry and suggests one from its entry", async () => {
    const repo = new RepoComponents({ folderRoot: folder, config, reservedIds: () => new Set() });
    expect(repo.preview(undefined)).toMatchObject({ kind: "file", label: "preview.jsx" });
    const catalog = await repo.catalog();
    const app = catalog.apps[0];
    if (!app) throw new Error("no app summary");
    const suggestion = suggestPreviewEntry(app, folder);
    expect(suggestion).toContain('import "../src/styles.css";');
    expect(suggestion).toContain('import { ThemeProvider } from "../src/components/theme";');
    expect(suggestion).toContain('<ThemeProvider accent="violet">');
    expect(suggestion).toContain("export default function Preview");
  });
});
