import { describe, expect, test } from "bun:test";
import { TAILWIND_CLASSNAME } from "@velloo/provider";
import type { ComponentNode } from "@velloo/schema";
import type { RepoCatalogEntry } from "../catalog.ts";
import {
  callSiteProps,
  type DrawnNode,
  judgeSweep,
  planSweep,
  repoSweepTarget,
  type SweepTarget,
  sweepTargets,
} from "../sweep.ts";

function entry(name: string, extra: Partial<RepoCatalogEntry> = {}): RepoCatalogEntry {
  return {
    id: name,
    name,
    identity: { importPath: `@/components/${name.toLowerCase()}`, exportName: name },
    key: `repo::@/components/${name.toLowerCase()}#${name}`,
    source: "local",
    family: name.split(".")[0] ?? name,
    props: [],
    acceptsChildren: false,
    states: [],
    provenance: [],
    styleProps: [],
    ...extra,
  };
}

const tone = {
  name: "tone",
  type: '"live" | "hold"',
  optional: true,
  control: "enum" as const,
  enumValues: ["live", "hold"],
  serializable: true,
};

const plan = (entries: RepoCatalogEntry[]) =>
  planSweep(entries.map(repoSweepTarget), { element: "Box", channel: TAILWIND_CLASSNAME });

/** A wrapper at `path`, with one drawn child of the given look — or bare text, or nothing. */
function drawn(
  path: string,
  look: { w: number; h: number; bg: string } | { text: string } | null,
): DrawnNode[] {
  const box = look && "w" in look ? look : null;
  const wrapper: DrawnNode = {
    depth: 3,
    tag: "div",
    rect: { x: 0, y: 0, w: 700, h: box?.h ?? (look ? 20 : 0) },
    style: {},
    nodePath: path,
    ...(look && "text" in look ? { text: look.text } : {}),
  };
  return box
    ? [
        wrapper,
        {
          depth: 4,
          tag: "span",
          rect: { x: 0, y: 0, w: box.w, h: box.h },
          style: { backgroundColor: box.bg },
        },
      ]
    : [wrapper];
}

describe("sweepTargets", () => {
  test("roots of the asked app: its own files first, then the most used; parts left out", () => {
    const targets = sweepTargets(
      [
        entry("Rare", { provenance: ["a.tsx:1"] }),
        entry("Tabs.List", {
          identity: { importPath: "@/tabs", exportName: "Tabs", member: "List" },
          provenance: ["a.tsx:1", "a.tsx:2", "a.tsx:3"],
        }),
        entry("PanelBody", { partOf: "Panel", provenance: ["a.tsx:1", "a.tsx:2", "a.tsx:3"] }),
        entry("Area", {
          source: "package",
          packageName: "recharts",
          provenance: ["a.tsx:1", "a.tsx:2", "a.tsx:3"],
        }),
        entry("ReactQueryDevtools", {
          source: "package",
          packageName: "@tanstack/react-query-devtools",
          provenance: ["a.tsx:1"],
        }),
        entry("Avatar", {
          source: "package",
          packageName: "@acme/ui",
          provenance: ["a.tsx:1", "a.tsx:2", "a.tsx:3"],
        }),
        entry("Common", { provenance: ["a.tsx:1", "b.tsx:2"] }),
        entry("Other", {
          identity: { importPath: "@/other", exportName: "Other", app: "admin" },
          provenance: ["a.tsx:1", "b.tsx:2", "c.tsx:3"],
        }),
      ],
      undefined,
    );
    // A design system's package follows the app's own files. A chart part and a
    // devtools panel draw nothing alone, and are not mounted alone.
    expect(targets.map((t) => t.id)).toEqual(["Common", "Rare", "Avatar"]);
  });
});

describe("callSiteProps", () => {
  test("a call site that passed no code is preferred, and one that did not restyle it over one that did", () => {
    const chip = entry("CountChip", {
      acceptsChildren: true,
      states: [
        { name: "a", props: { children: "3" }, source: "usage", dropped: ["onClick"] },
        { name: "b", props: { className: "text-paper", children: "12" }, source: "usage" },
        { name: "c", props: { children: "4" }, source: "usage" },
      ],
    });
    expect(callSiteProps(chip)).toEqual({ props: { children: "4" }, missing: [] });
    // Restyled at its only call site: mounted as itself, not dressed for there.
    const onRail = entry("CountChip", {
      acceptsChildren: true,
      states: [{ name: "a", props: { className: "bg-paper/10 text-paper" }, source: "usage" }],
    });
    expect(callSiteProps(onRail)).toEqual({ props: { children: "CountChip" }, missing: [] });
  });

  test("what the instance goes without is named: code a call site passed, and required props nobody gave", () => {
    const table = entry("DataTable", {
      props: [
        {
          name: "columns",
          type: "Column[]",
          optional: false,
          control: "string",
          serializable: false,
        },
        { name: "dense", type: "boolean", optional: true, control: "boolean", serializable: true },
      ],
      states: [{ name: "a", props: { dense: true }, source: "usage", dropped: ["rows"] }],
    });
    expect(callSiteProps(table)).toEqual({ props: { dense: true }, missing: ["rows", "columns"] });
  });
});

describe("planSweep", () => {
  test("a component with a variant prop is mounted twice, differing in that prop alone", () => {
    const chip = entry("StatusChip", {
      props: [tone],
      acceptsChildren: true,
      states: [{ name: "As used at app/page.tsx:9", props: { tone: "hold" }, source: "usage" }],
    });
    const { cells, screen } = plan([chip]);
    // The app's own value first, then a different one.
    expect(cells[0]?.target.variant).toEqual({ prop: "tone", values: ["hold", "live"] });
    expect(cells[0]?.paths).toEqual(["0.1.0", "0.1.1"]);
    // The paths are where the wrappers really sit in the tree that is rendered.
    const cell = (screen.tree as ComponentNode).children?.[0] as ComponentNode;
    const row = cell.children?.[1] as ComponentNode;
    const mounted = (row.children ?? []).map(
      (wrapper) => (wrapper as ComponentNode).children?.[0] as ComponentNode,
    );
    expect(mounted.map((node) => node.props)).toEqual([
      { tone: "hold", children: "StatusChip" },
      { tone: "live", children: "StatusChip" },
    ]);
    expect(mounted[1]?.$repo).toEqual(chip.identity);
  });

  test("a target that is not the app's own is mounted as it was handed over", () => {
    const button: SweepTarget = {
      id: "Button",
      key: "Button",
      node: { $ref: "Button", props: { children: "Save" } },
      variant: { prop: "variant", values: ["default", "outline"] },
      missing: [],
    };
    const { cells, screen } = planSweep([button], { element: "Box", channel: TAILWIND_CLASSNAME });
    expect(cells[0]?.paths).toHaveLength(2);
    expect(JSON.stringify(screen.tree)).toContain('"variant":"outline"');
  });
});

describe("judgeSweep", () => {
  const chip = entry("StatusChip", { props: [tone], acceptsChildren: true });
  const exact = [{ id: chip.key, status: "exact" }];

  test("two variants that draw differently are fine", () => {
    const nodes = [
      ...drawn("0.1.0", { w: 80, h: 24, bg: "rgb(0, 128, 0)" }),
      ...drawn("0.1.1", { w: 80, h: 24, bg: "rgb(200, 0, 0)" }),
    ];
    expect(judgeSweep(plan([chip]), nodes, exact)).toMatchObject({
      checked: 1,
      ok: ["StatusChip"],
      problems: [],
    });
  });

  test("two variants that draw the same thing are flagged, with the prop named", () => {
    const same = { w: 80, h: 24, bg: "rgba(0, 0, 0, 0)" };
    const verdict = judgeSweep(
      plan([chip]),
      [...drawn("0.1.0", same), ...drawn("0.1.1", same)],
      exact,
    );
    expect(verdict.ok).toEqual([]);
    expect(verdict.problems[0]).toMatchObject({
      id: "StatusChip",
      status: "exact",
      flags: ["variantsIdentical"],
      size: { w: 80, h: 24 },
    });
    expect(verdict.problems[0]?.detail).toContain('`tone="live"` and `tone="hold"`');
  });

  test("a hairline across its column is a separator, not a sliver", () => {
    const rule = entry("Separator");
    const verdict = judgeSweep(plan([rule]), drawn("0.1.0", { w: 700, h: 1, bg: "rgb(0, 0, 0)" }), [
      { id: rule.key, status: "exact" },
    ]);
    expect(verdict.ok).toEqual(["Separator"]);
  });

  test("a mount that drew nothing is blank; a sliver is thin; bare text is neither", () => {
    const blank = entry("Empty");
    const thin = entry("Rule");
    const text = entry("FormScope");
    const verdict = judgeSweep(
      plan([blank, thin, text]),
      [
        ...drawn("0.1.0", null),
        ...drawn("1.1.0", { w: 0, h: 350, bg: "rgb(0, 0, 0)" }),
        ...drawn("2.1.0", { text: "FormScope" }),
      ],
      [blank, thin, text].map((e) => ({ id: e.key, status: "exact" })),
    );
    expect(verdict.problems.map((f) => [f.id, f.flags])).toEqual([
      ["Empty", ["blank"]],
      ["Rule", ["thin"]],
    ]);
    expect(verdict.ok).toEqual(["FormScope"]);
  });

  test("a component the mount could not render keeps its code and remedy", () => {
    const broken = entry("Broken");
    const verdict = judgeSweep(
      plan([broken]),
      [],
      [
        {
          id: broken.key,
          status: "unavailable",
          code: "missing-provider",
          remedy: "Wrap it in the preview entry.",
        },
      ],
    );
    expect(verdict.problems).toEqual([
      {
        id: "Broken",
        status: "unavailable",
        code: "missing-provider",
        remedy: "Wrap it in the preview entry.",
      },
    ]);
  });

  test("going without props it needs is inconclusive, whatever the mount guessed the cause was", () => {
    const chart = entry("Chart", {
      states: [{ name: "a", props: {}, source: "usage", dropped: ["data"] }],
    });
    const nav = entry("NavUser", {
      props: [
        { name: "user", type: "User", optional: false, control: "string", serializable: false },
      ],
    });
    const quiet = entry("Devtools", {
      states: [{ name: "a", props: {}, source: "usage", dropped: ["router"] }],
    });
    const verdict = judgeSweep(
      plan([chart, nav, quiet]),
      [...drawn("2.1.0", null)],
      [
        { id: chart.key, status: "unavailable", code: "render-threw" },
        { id: nav.key, status: "unavailable", code: "missing-provider" },
        { id: quiet.key, status: "exact" },
      ],
    );
    expect(verdict.problems).toEqual([]);
    expect(verdict.inconclusive.map((f) => f.id)).toEqual(["Chart", "NavUser", "Devtools"]);
    expect(verdict.inconclusive[0]?.detail).toContain("`data`");
    expect(verdict.inconclusive[1]?.detail).toContain("`user`");
  });

  test("a component the mount never reported is not counted as fine", () => {
    const verdict = judgeSweep(plan([chip]), [], []);
    expect(verdict.ok).toEqual([]);
    expect(verdict.problems[0]?.status).toBe("unchecked");
  });
});
