import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoKey } from "@velloo/schema";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import type { RepoCatalog } from "../catalog.ts";
import { resolveRepoRef } from "../resolve-ref.ts";
import { createRepoComponents } from "../store.ts";
import { suggestPreviewEntry } from "../suggest-preview.ts";

/**
 * One module, reached by two spellings. An app imports `@/components/panel`
 * from a page and `./panel` from the file beside it; both name the same file,
 * and for a long time the catalog listed the component once for each — two
 * entries, two qualified ids, mounted twice by every sweep.
 */
let app: string;
let t: TestContext;
let catalog: RepoCatalog;

const ALIAS = "@/components/panel";
const RELATIVE = "./components/panel";

beforeAll(async () => {
  app = await realpath(await mkdtemp(join(tmpdir(), "velloo-repo-spellings-")));
  await mkdir(join(app, "components"), { recursive: true });
  await mkdir(join(app, "app/queue"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "spellings-app" }));
  await writeFile(
    join(app, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } } }),
  );
  await writeFile(
    join(app, "components/panel.tsx"),
    [
      "export function Panel({ cap, children }: { cap?: string; children?: React.ReactNode }) {",
      "  return <section data-cap={cap}>{children}</section>;",
      "}",
      "export function ThemeProvider({ children }: { children?: React.ReactNode }) { return <>{children}</>; }",
      "",
    ].join("\n"),
  );
  // Reached relatively first (files are walked in order), then by the alias.
  await writeFile(
    join(app, "app/page.tsx"),
    [
      'import { Panel, ThemeProvider } from "../components/panel";',
      "export default function Page() {",
      '  return <ThemeProvider><Panel cap="ink">Berths</Panel></ThemeProvider>;',
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(app, "app/queue/page.tsx"),
    [
      `import { Panel, ThemeProvider } from "${ALIAS}";`,
      "export default function Queue() {",
      '  return <ThemeProvider><Panel cap="acid">Queue</Panel></ThemeProvider>;',
      "}",
      "",
    ].join("\n"),
  );
  t = await testContext({ config: designConfig({ hostApp: { root: app } }) });
  // An override written when the relative spelling was the one the catalog led with.
  await writeFile(
    join(t.folder.root, "repo-components.json"),
    JSON.stringify({
      components: { [`${RELATIVE}#Panel`]: { description: "The app's surface." } },
    }),
  );
  const repo = createRepoComponents(t.folder, t.ctx.providers);
  t.ctx.repo = repo;
  catalog = await repo.catalog();
});

afterAll(async () => {
  await t.cleanup();
  await rm(app, { recursive: true, force: true });
});

describe("a module the app imports by two spellings", () => {
  test("is one component, known by its alias, with every call site", () => {
    const panels = catalog.entries.filter((entry) => entry.name === "Panel");
    expect(panels).toHaveLength(1);
    const [panel] = panels;
    // No second source, so nothing to qualify the id against.
    expect(panel?.id).toBe("Panel");
    expect(panel?.qualifiedBecause).toBeUndefined();
    expect(panel?.identity.importPath).toBe(ALIAS);
    expect(panel?.alsoImportedAs).toEqual([RELATIVE]);
    expect(panel?.provenance).toEqual(["app/page.tsx:3", "app/queue/page.tsx:3"]);
    expect(panel?.states.map((state) => state.props.cap)).toEqual(["ink", "acid"]);
  });

  test("a node saved under the other spelling still finds it", () => {
    const panel = catalog.byId.get("Panel");
    const saved = { importPath: RELATIVE, exportName: "Panel" };
    expect(catalog.byKey.get(repoKey(saved))).toBe(panel);
    expect(catalog.byKey.get(repoKey({ ...saved, importPath: ALIAS }))).toBe(panel);
  });

  test("an identity given by either spelling is written under the one the catalog leads with", async () => {
    const node = await resolveRepoRef(t.ctx, "Panel", {
      importPath: RELATIVE,
      exportName: "Panel",
    });
    expect(node).toEqual({ $ref: "Panel", $repo: { importPath: ALIAS, exportName: "Panel" } });
  });

  test("an override keyed by the other spelling is still this component's", () => {
    expect(catalog.byId.get("Panel")?.description).toBe("The app's surface.");
    expect(catalog.warnings).toEqual([]);
  });

  test("a provider wrapped around two entries by two spellings is one wrapper", () => {
    const [summary] = catalog.apps;
    expect(summary?.wrappers.map((wrapper) => wrapper.identity.importPath)).toEqual([ALIAS]);
    const suggestion = suggestPreviewEntry(summary as NonNullable<typeof summary>, t.folder.root);
    expect(suggestion.match(/import \{ ThemeProvider \}/g)).toHaveLength(1);
  });
});
