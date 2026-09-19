import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ComponentDescriptor } from "@velloo/provider";
import type { Screen } from "@velloo/schema";
import type { RepoCatalogEntry, RepoPropDescriptor } from "../api.ts";
import { $, $$, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The app's own components in the Library and the inspector, against the
 * fake daemon's `/api/repo/*`. The property that matters most is the one the
 * inspector test pins: a repo node named `Button` reads its controls from the
 * repo entry, never from the provider's unrelated `Button`.
 */

const { LibrarySidebar } = await import("../components/LibrarySidebar.tsx");
const { Inspector } = await import("../components/Inspector.tsx");
const { LibraryDetail } = await import("../components/LibraryDetail.tsx");
const { useCanvas } = await import("../store.ts");

const prop = (name: string, extra: Partial<RepoPropDescriptor> = {}): RepoPropDescriptor => ({
  name,
  type: "string",
  optional: true,
  control: "string",
  serializable: true,
  ...extra,
});

function entry(
  over: Partial<RepoCatalogEntry> & Pick<RepoCatalogEntry, "id" | "identity">,
): RepoCatalogEntry {
  const { identity } = over;
  const name = [identity.exportName, identity.member].filter(Boolean).join(".");
  return {
    name,
    key: `repo::${identity.importPath}#${name}`,
    source: "package",
    packageName: identity.importPath,
    family: identity.exportName,
    props: [],
    acceptsChildren: true,
    states: [],
    provenance: [],
    styleProps: [],
    ...over,
  };
}

const MANTINE = "@mantine/core";

const catalog = (): RepoCatalogEntry[] => [
  entry({
    id: "Tabs",
    identity: { importPath: MANTINE, exportName: "Tabs" },
    parts: ["List", "Tab", "Panel"],
  }),
  entry({ id: "Tabs.List", identity: { importPath: MANTINE, exportName: "Tabs", member: "List" } }),
  entry({
    id: "Mantine.Button",
    identity: { importPath: MANTINE, exportName: "Button" },
    recipe: "mantine",
    styleProps: ["className", "style"],
    qualifiedBecause: "the provider also has a Button",
    props: [
      prop("radius", { control: "enum", enumValues: ["xs", "sm", "md"] }),
      prop("onClick", { serializable: false, constraint: "A function can't be held by a design." }),
      prop("leftSection", { slot: true }),
      prop("color", { inherited: true }),
    ],
  }),
  entry({
    id: "StatCard",
    identity: { importPath: "./src/StatCard", exportName: "StatCard" },
    source: "local",
    packageName: undefined,
    provenance: ["src/App.jsx:12"],
  }),
];

/** The provider's own `Button` — what a `$ref` lookup would wrongly find. */
const providerButton: ComponentDescriptor = {
  id: "Button",
  category: "ui",
  source: "shadcn",
  props: [
    {
      name: "variant",
      type: "string",
      optional: true,
      control: "enum",
      enumValues: ["default", "ghost"],
    },
  ],
} as ComponentDescriptor;

let server: FakeServer;

beforeEach(async () => {
  server = serveFolder();
  server.repoEntries = catalog();
  server.manifest = [providerButton];
  server.repoStatus = {
    "Mantine.Button": { id: "Mantine.Button", status: "exact" },
    Tabs: { id: "Tabs", status: "adapted", note: "Portals render inline." },
    StatCard: { id: "StatCard", status: "unstyled" },
  };
  useCanvas.setState({
    components: null,
    componentsLoading: false,
    selection: null,
    libraryItem: null,
    screens: {},
  });
  await useCanvas.getState().reloadRepoCatalog();
});

afterEach(() => {
  server.restore();
});

const statusCalls = () => server.calls.filter((c) => c.startsWith("/api/repo/status"));

domSuite("Library Repo area", () => {
  test("groups family roots by source, the app's own code first", async () => {
    const view = await mount(<LibrarySidebar snippets={[]} />);
    try {
      await settle(0);
      const sources = $$("[data-repo-source]").map((el) => el.dataset.repoSource);
      expect(sources).toEqual(["This app", MANTINE]);

      const ids = $$("[data-repo-id]").map((el) => el.dataset.repoId);
      // Parts live on their family's page, not as peers of it.
      expect(ids).not.toContain("Tabs.List");
      expect(ids).toContain("StatCard");
    } finally {
      await view.unmount();
    }
  });

  test("asks status only for open sections, and shows it once known", async () => {
    const view = await mount(<LibrarySidebar snippets={[]} />);
    try {
      await settle(300);
      // Only "This app" starts open when there's more than one source.
      expect(statusCalls()).toEqual(["/api/repo/status?ids=StatCard"]);
      expect($('[data-repo-id="StatCard"] [data-fidelity]')?.dataset.fidelity).toBe("unstyled");

      const trigger = $(`[data-repo-source="${MANTINE}"] button`) as HTMLElement;
      await interact(() => trigger.click());
      await settle(300);
      expect(statusCalls()[1]).toBe("/api/repo/status?ids=Mantine.Button,Tabs");
      expect(text($('[data-repo-id="Tabs"]'))).toContain("adapted");
    } finally {
      await view.unmount();
    }
  });

  test("search reaches families through their parts and hides what misses", async () => {
    const view = await mount(<LibrarySidebar snippets={[]} />);
    try {
      await settle(0);
      const input = $('input[placeholder="Search library…"]') as HTMLInputElement;
      await interact(() => typeInto(input, "list"));
      expect($$("[data-repo-id]").map((el) => el.dataset.repoId)).toEqual(["Tabs"]);

      await interact(() => typeInto(input, "nothing-like-this"));
      expect($("[data-repo-shelves]")).toBeNull();
    } finally {
      await view.unmount();
    }
  });

  test("a row opens the repo detail item", async () => {
    const view = await mount(<LibrarySidebar snippets={[]} />);
    try {
      await settle(0);
      await interact(() => ($('[data-repo-id="StatCard"]') as HTMLElement).click());
      expect(useCanvas.getState().libraryItem).toEqual({ kind: "repo", id: "StatCard" });
    } finally {
      await view.unmount();
    }
  });
});

function selectNode(tree: Screen["tree"]): void {
  useCanvas.setState({
    screens: { home: { id: "home", name: "home", tree } as Screen },
    selection: { screenId: "home", path: "" },
  });
}

domSuite("Inspector on a repo node", () => {
  test("controls come from the repo entry, not the provider's same-named component", async () => {
    selectNode({ $ref: "Button", $repo: { importPath: MANTINE, exportName: "Button" }, props: {} });
    const view = await mount(<Inspector />);
    try {
      await settle(300);
      const block = $("[data-repo-block]");
      expect(text(block)).toContain(MANTINE);
      expect(text(block)).toContain("Button");
      expect($("[data-repo-block] [data-fidelity]")?.dataset.fidelity).toBe("exact");
      expect(text($("[data-repo-styling]"))).toContain("Styled by mantine's theme");

      expect($("#prop-radius")).not.toBeNull();
      expect($("#prop-variant")).toBeNull();
      // A callback and a React-node slot are nothing a design can hold.
      expect($("#prop-onClick")).toBeNull();
      expect($("#prop-leftSection")).toBeNull();
      // Inherited props wait behind their count.
      expect($("#prop-color")).toBeNull();
      expect(text($("[data-repo-props]"))).toContain("1 inherited prop");
    } finally {
      await view.unmount();
    }
  });

  test("an identity the catalog doesn't know still says what it is", async () => {
    selectNode({ $ref: "Gone", $repo: { importPath: "./src/Gone", exportName: "Gone" } });
    const view = await mount(<Inspector />);
    try {
      await settle(0);
      expect(text($("[data-repo-block]"))).toContain("./src/Gone");
      expect($("[data-repo-missing]")).not.toBeNull();
      expect(statusCalls()).toEqual([]);
    } finally {
      await view.unmount();
    }
  });
});

domSuite("Library repo detail", () => {
  test("shows the import, previews by state, and adds by identity", async () => {
    server.repoEntries = catalog().map((e) =>
      e.id === "Mantine.Button"
        ? {
            ...e,
            states: [
              { name: "filled", props: { variant: "filled" }, source: "story" as const },
              { name: "light", props: { variant: "light" }, source: "usage" as const },
            ],
          }
        : e,
    );
    await useCanvas.getState().reloadRepoCatalog();
    await useCanvas.getState().loadRepoCatalog();
    useCanvas.setState({ currentScreenId: "home", selection: null });
    const view = await mount(
      <LibraryDetail item={{ kind: "repo", id: "Mantine.Button" }} snippets={[]} />,
    );
    try {
      await settle(300);
      expect(($('input[aria-label="Import"]') as HTMLInputElement).value).toBe(
        'import { Button } from "@mantine/core";',
      );
      expect(text($("[data-repo-detail]"))).toContain("the provider also has a Button");
      const frames = $$("[data-repo-detail] iframe").map((f) => f.getAttribute("src") ?? "");
      expect(frames).toHaveLength(2);
      expect(frames[1]).toContain("/api/render/repo/Mantine.Button?state=1");
      // Own props listed; the inherited one waits behind its count.
      expect($('[data-prop="radius"]')).not.toBeNull();
      expect($('[data-prop="color"]')).toBeNull();

      const add = $$("button").find((b) => text(b) === "Add to screen") as HTMLElement;
      await interact(() => add.click());
      await settle(0);
      expect(server.mutations.at(-1)).toEqual({
        op: "add_node",
        args: {
          screenId: "home",
          parentPath: [],
          componentRef: "Button",
          repo: { importPath: MANTINE, exportName: "Button" },
          props: { variant: "filled" },
        },
      });
    } finally {
      await view.unmount();
    }
  });
});
