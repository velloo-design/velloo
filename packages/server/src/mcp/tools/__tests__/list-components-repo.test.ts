import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { createRepoComponents } from "../../../repo/store.ts";
import { designConfig, type TestContext, testContext } from "../../../testing/design-folder.ts";
import { registerDiscoveryTools } from "../discovery.ts";
import type { McpResult } from "../result.ts";

/**
 * `list_components` over an app's own components — the first thing an agent
 * reads about them. What it says a component is (its author's description, a
 * part of another, an icon) and whether there is anything to set up at all
 * decide the calls that follow: an agent sent to a preview entry for an app
 * with only pages spends them on nothing.
 */

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<McpResult>;

let t: TestContext | undefined;
let appRoot: string | undefined;

afterEach(async () => {
  await t?.cleanup();
  if (appRoot) await rm(appRoot, { recursive: true, force: true });
  t = undefined;
  appRoot = undefined;
});

const ENTRY = {
  "package.json": JSON.stringify({ dependencies: { react: "*", "react-dom": "*" } }),
  "index.html": '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
  "src/main.jsx":
    'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
};

async function listComponents(files: Record<string, string>, args: Record<string, unknown> = {}) {
  if (!t) {
    appRoot = await mkdtemp(join(tmpdir(), "velloo-list-app-"));
    for (const [rel, contents] of Object.entries({ ...ENTRY, ...files })) {
      await mkdir(dirname(join(appRoot, rel)), { recursive: true });
      await writeFile(join(appRoot, rel), contents, "utf8");
    }
    t = await testContext({
      label: "list-components-repo",
      provider: createNoneProvider(),
      config: designConfig({
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
        hostApp: { root: appRoot },
      }),
    });
    t.ctx.repo = createRepoComponents(t.folder, t.ctx.providers);
  }
  const mcp = new McpServer({ name: "test", version: "0.0.0" });
  registerDiscoveryTools(mcp, t.ctx);
  const tools = (mcp as unknown as { _registeredTools: Record<string, { handler: ToolHandler }> })
    ._registeredTools;
  const result = await (tools.list_components as { handler: ToolHandler }).handler(args, {});
  const first = result.content[0];
  return JSON.parse(first?.type === "text" ? first.text : "{}") as Record<string, unknown>;
}

const KIT = {
  "src/App.jsx": `import { IconGithub, IconSearch } from "./components/icons";
import { Panel, PanelBody } from "./components/panel";
import { Tag } from "./components/tag";

export function App() {
  return (
    <main>
      <Panel title="Queue">
        <PanelBody>Three jobs waiting.</PanelBody>
      </Panel>
      <Tag tone="live">Live</Tag>
      <Tag tone="hold">On hold</Tag>
      <IconGithub />
      <IconSearch />
    </main>
  );
}
`,
  "src/components/panel.tsx": `import type { ReactNode } from "react";

/** A titled surface for one group of readings. */
export function Panel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function PanelBody({ children }: { children?: ReactNode }) {
  return <div>{children}</div>;
}
`,
  "src/components/tag.tsx": `import type { ReactNode } from "react";

export function Tag({ tone = "live", children }: { tone?: "live" | "hold"; children?: ReactNode }) {
  return <span data-tone={tone}>{children}</span>;
}
`,
  "src/components/icons.tsx": `export function IconGithub() {
  return <svg aria-hidden="true" />;
}
export function IconSearch() {
  return <svg aria-hidden="true" />;
}
`,
};

interface Index {
  groups: {
    group: string;
    label: string;
    families: { id: string; pieces?: string[]; designModeNotes?: string }[];
  }[];
  repo?: {
    note: string;
    icons?: { source: string; inUse: number; examples: string[] }[];
    iconsNote?: string;
    apps?: { preview: string }[];
  };
}

describe("list_components on an app with components of its own", () => {
  const shelf = (index: Index) => index.groups.find((group) => group.group === "repo:app");
  const family = (index: Index, id: string) =>
    shelf(index)?.families.find((entry) => entry.id === id);

  test("the app's shelf comes first, with a part folded into its root and the author's own description", async () => {
    const index = (await listComponents(KIT)) as unknown as Index;
    expect(index.groups[0]).toMatchObject({
      group: "repo:app",
      label: "Repo · this app's components",
    });
    // The doc comment above the component, then where the app uses it.
    expect(family(index, "Panel")).toEqual({
      id: "Panel",
      pieces: ["PanelBody"],
      designModeNotes: "A titled surface for one group of readings. Used at src/App.jsx:8.",
    });
    expect(family(index, "Tag")?.designModeNotes).toBe("Used at src/App.jsx:11 (+1).");
    // A part's call sites are its root's: it adds no note of its own to bury the root's under.
    expect(family(index, "PanelBody")).toBeUndefined();
  });

  test("icons are counted in the note instead of taking a line each, and a filter still finds one", async () => {
    const index = (await listComponents(KIT)) as unknown as Index;
    expect(family(index, "IconGithub")).toBeUndefined();
    expect(index.repo?.icons).toEqual([
      { source: "app", inUse: 2, examples: ["IconGithub", "IconSearch"] },
    ]);
    expect(index.repo?.iconsNote).toContain("Icons are counted, not listed");

    const found = (await listComponents(KIT, { filter: "IconGithub" })) as unknown as Index;
    expect(shelf(found)?.families.map((entry) => entry.id)).toEqual(["IconGithub"]);
  });

  test("says the shelves need the preview entry checked once, and where that stands", async () => {
    const index = (await listComponents(KIT)) as unknown as Index;
    expect(index.repo?.note).toContain("check it once with preview_status");
    expect(index.repo?.apps).toEqual([{ preview: "no preview entry" }]);
  });

  test("summary names each component's props and the call sites it can be drawn as; full says what it is", async () => {
    const summary = (await listComponents(KIT, { kind: "repo", mode: "summary" })) as {
      components: Record<string, unknown>[];
    };
    const byId = new Map(summary.components.map((entry) => [entry.id, entry]));
    expect(byId.get("Tag")).toEqual({
      id: "Tag",
      kind: "repo",
      importPath: "./src/components/tag",
      props: ["tone", "children"],
      states: ["As used at src/App.jsx:11", "As used at src/App.jsx:12"],
      designModeNotes: "Used at src/App.jsx:11 (+1).",
      availableInDesign: true,
      installedInApp: true,
    });
    // The icons the index only counted are listed here, as its note promises.
    expect(byId.has("IconSearch")).toBe(true);
    expect(byId.get("IconSearch")?.states).toBeUndefined();

    const full = (await listComponents(KIT, { kind: "repo", mode: "full" })) as {
      components: Record<string, unknown>[];
    };
    const described = new Map(full.components.map((entry) => [entry.id, entry]));
    expect(described.get("IconSearch")).toMatchObject({ role: "icon", group: "repo:app" });
    expect(described.get("PanelBody")).toMatchObject({ family: "Panel", exportName: "PanelBody" });
    expect(described.get("Panel")?.role).toBeUndefined();
  });
});

describe("list_components on an app with nothing to build from", () => {
  const PAGES = {
    "src/App.jsx": `import { IconGithub } from "./components/icons";
import Reports from "./pages/reports";

export function App() {
  return (
    <main>
      <IconGithub />
      <Reports />
    </main>
  );
}
`,
    "src/pages/reports.jsx":
      "export default function Reports() {\n  return <section>Reports</section>;\n}\n",
    "src/components/icons.tsx": KIT["src/components/icons.tsx"],
  };

  test("says so, and sends nobody to set up a preview entry for pages", async () => {
    const index = (await listComponents(PAGES)) as unknown as Index;
    expect(index.repo?.note).toContain("hold only this app's pages and its router");
    expect(index.repo?.note).toContain("no preview entry is needed");
    expect(index.repo?.note).not.toContain("preview_status");
    expect(index.repo?.apps).toBeUndefined();
    // Its icons are still worth knowing about: they are placed by name.
    expect(index.repo?.icons).toEqual([{ source: "app", inUse: 1, examples: ["IconGithub"] }]);
  });
});
