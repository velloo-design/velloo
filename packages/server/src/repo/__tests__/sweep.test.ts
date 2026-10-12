import { describe, expect, test } from "bun:test";
import { TAILWIND_CLASSNAME } from "@velloo/provider";
import type { ComponentNode } from "@velloo/schema";
import type { RepoCatalogEntry } from "../catalog.ts";
import { type DrawnNode, judgeSweep, planSweep, sweepTargets } from "../sweep.ts";

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

const plan = (entries: RepoCatalogEntry[], limit?: number) =>
  planSweep(entries, { element: "Box", channel: TAILWIND_CLASSNAME, limit });

/** A wrapper at `path` with one drawn child of the given look. */
function drawn(path: string, look: { w: number; h: number; bg: string } | null): DrawnNode[] {
  const wrapper: DrawnNode = {
    depth: 3,
    tag: "div",
    rect: { x: 0, y: 0, w: look?.w ?? 0, h: look?.h ?? 0 },
    style: {},
    nodePath: path,
  };
  return look
    ? [
        wrapper,
        {
          depth: 4,
          tag: "span",
          rect: { x: 0, y: 0, w: look.w, h: look.h },
          style: { backgroundColor: look.bg },
        },
      ]
    : [wrapper];
}

describe("sweepTargets", () => {
  test("mounts roots of the asked app, most used first", () => {
    const targets = sweepTargets(
      [
        entry("Rare", { provenance: ["a.tsx:1"] }),
        entry("Tabs.List", {
          identity: { importPath: "@/tabs", exportName: "Tabs", member: "List" },
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
    expect(targets.map((t) => t.id)).toEqual(["Common", "Rare"]);
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
    expect(cells[0]?.variant).toEqual({ prop: "tone", values: ["hold", "live"] });
    expect(cells[0]?.instances).toEqual([
      { path: "0.1.0", props: { tone: "hold", children: "StatusChip" } },
      { path: "0.1.1", props: { tone: "live", children: "StatusChip" } },
    ]);
    // The paths are where the wrappers really sit in the tree that is rendered.
    const cell = (screen.tree as ComponentNode).children?.[0] as ComponentNode;
    const row = cell.children?.[1] as ComponentNode;
    const wrapper = row.children?.[1] as ComponentNode;
    const mounted = wrapper.children?.[0] as ComponentNode;
    expect(mounted).toMatchObject({ $ref: "StatusChip", props: { tone: "live" } });
    expect(mounted.$repo).toEqual(chip.identity);
  });

  test("a call site that passed no code is preferred, and what the other dropped is kept", () => {
    const table = entry("DataTable", {
      states: [
        { name: "a", props: { dense: true }, source: "usage", dropped: ["rows"] },
        { name: "b", props: { dense: false }, source: "usage" },
      ],
    });
    expect(plan([table]).cells[0]?.instances[0]?.props).toEqual({ dense: false });
    const onlyCode = entry("Chart", {
      states: [{ name: "a", props: {}, source: "usage", dropped: ["data"] }],
    });
    expect(plan([onlyCode]).cells[0]?.dropped).toEqual(["data"]);
  });

  test("what the limit leaves out is named", () => {
    const { cells, notChecked } = plan([entry("A"), entry("B"), entry("C")], 2);
    expect(cells.map((c) => c.entry.id)).toEqual(["A", "B"]);
    expect(notChecked).toEqual(["C"]);
  });
});

describe("judgeSweep", () => {
  const chip = entry("StatusChip", { props: [tone], acceptsChildren: true });
  const exact = [{ id: chip.key, status: "exact" }];

  test("two variants that draw differently are fine", () => {
    const p = plan([chip]);
    const nodes = [
      ...drawn("0.1.0", { w: 80, h: 24, bg: "rgb(0, 128, 0)" }),
      ...drawn("0.1.1", { w: 80, h: 24, bg: "rgb(200, 0, 0)" }),
    ];
    expect(judgeSweep(p, nodes, exact)).toMatchObject({
      checked: 1,
      ok: ["StatusChip"],
      problems: [],
    });
  });

  test("two variants that draw the same thing are flagged, with the prop named", () => {
    const p = plan([chip]);
    const same = { w: 80, h: 24, bg: "rgba(0, 0, 0, 0)" };
    const verdict = judgeSweep(p, [...drawn("0.1.0", same), ...drawn("0.1.1", same)], exact);
    expect(verdict.ok).toEqual([]);
    expect(verdict.problems[0]).toMatchObject({
      id: "StatusChip",
      status: "exact",
      flags: ["variantsIdentical"],
      size: { w: 80, h: 24 },
    });
    expect(verdict.problems[0]?.detail).toContain('`tone="live"` and `tone="hold"`');
  });

  test("a mount that drew nothing is blank; a sliver is thin", () => {
    const blank = entry("Empty");
    const thin = entry("Rule");
    const p = plan([blank, thin]);
    const verdict = judgeSweep(
      p,
      [...drawn("0.1.0", null), ...drawn("1.1.0", { w: 300, h: 1, bg: "rgb(0, 0, 0)" })],
      [
        { id: blank.key, status: "exact" },
        { id: thin.key, status: "exact" },
      ],
    );
    expect(verdict.problems.map((f) => [f.id, f.flags])).toEqual([
      ["Empty", ["blank"]],
      ["Rule", ["thin"]],
    ]);
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

  test("throwing without the code its call site passes is inconclusive, not broken", () => {
    const chart = entry("Chart", {
      states: [{ name: "a", props: {}, source: "usage", dropped: ["data"] }],
    });
    const verdict = judgeSweep(
      plan([chart]),
      [],
      [{ id: chart.key, status: "unavailable", code: "render-threw" }],
    );
    expect(verdict.problems).toEqual([]);
    expect(verdict.inconclusive[0]?.detail).toContain("`data`");
  });

  test("a component the mount never reported is not counted as fine", () => {
    const verdict = judgeSweep(plan([chip]), [], []);
    expect(verdict.ok).toEqual([]);
    expect(verdict.problems[0]?.status).toBe("unchecked");
  });
});
