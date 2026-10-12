import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import { buildingBlocks, iconSources, type RepoCatalog } from "../catalog.ts";
import { createRepoComponents } from "../store.ts";

/**
 * What a catalog says about a component beyond its props: which flat-named
 * exports are parts of another, and which entries are icons or providers
 * rather than parts to build with.
 */
let app: string;
let t: TestContext;
let catalog: RepoCatalog;

beforeAll(async () => {
  app = await realpath(await mkdtemp(join(tmpdir(), "velloo-repo-parts-")));
  await mkdir(join(app, "components"), { recursive: true });
  await mkdir(join(app, "app"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "parts-app" }));
  await writeFile(
    join(app, "components/panel.tsx"),
    [
      "/** A bordered surface with a coloured cap. */",
      "export function Panel({ children }: { children?: React.ReactNode }) { return <section>{children}</section>; }",
      "export function PanelHeader({ children }: { children?: React.ReactNode }) { return <header>{children}</header>; }",
      "export function PanelHeaderTitle({ children }: { children?: React.ReactNode }) { return <h3>{children}</h3>; }",
      "export function Readout({ value }: { value: string }) { return <b>{value}</b>; }",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(app, "components/icons.tsx"),
    [
      "export function IconAnchor() { return <svg />; }",
      "export function ThemeProvider({ children }: { children?: React.ReactNode }) { return <>{children}</>; }",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(app, "app/page.tsx"),
    [
      'import { Panel, PanelHeader, PanelHeaderTitle, Readout } from "../components/panel";',
      'import { IconAnchor, ThemeProvider } from "../components/icons";',
      "export default function Page() {",
      "  return (",
      "    <ThemeProvider>",
      "      <Panel>",
      "        <PanelHeader><PanelHeaderTitle>Berths</PanelHeaderTitle><IconAnchor /></PanelHeader>",
      '        <Readout value="12" />',
      "      </Panel>",
      "    </ThemeProvider>",
      "  );",
      "}",
      "",
    ].join("\n"),
  );
  t = await testContext({ config: designConfig({ hostApp: { root: app } }) });
  catalog = await createRepoComponents(t.folder, t.ctx.providers).catalog();
});

afterAll(async () => {
  await t.cleanup();
  await rm(app, { recursive: true, force: true });
});

describe("what the catalog says a component is", () => {
  test("a flat-named export is a part of the shortest name it continues, in its own module", () => {
    expect(catalog.byId.get("PanelHeader")?.partOf).toBe("Panel");
    // A part of a part still points at the component a designer starts from.
    expect(catalog.byId.get("PanelHeaderTitle")?.partOf).toBe("Panel");
    expect(catalog.byId.get("Panel")?.partOf).toBeUndefined();
    expect(catalog.byId.get("Readout")?.partOf).toBeUndefined();
  });

  test("the app's icons are marked, and are not building blocks", () => {
    expect(catalog.byId.get("IconAnchor")?.kind).toBe("icon");
    expect(buildingBlocks(catalog).map((entry) => entry.id)).not.toContain("IconAnchor");
    expect(iconSources(catalog)).toEqual([{ source: "app", inUse: 1, examples: ["IconAnchor"] }]);
  });

  test("the doc comment above a component is its description", () => {
    expect(catalog.byId.get("Panel")?.description).toBe("A bordered surface with a coloured cap.");
    expect(catalog.byId.get("PanelHeader")?.description).toBeUndefined();
  });
});
