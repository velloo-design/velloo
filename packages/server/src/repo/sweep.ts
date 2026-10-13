import type { PropDescriptor, StyleChannel } from "@velloo/provider";
import type { ComponentNode, Node, Screen } from "@velloo/schema";
import { isChartLibrary } from "../theme/chart-libs.ts";
import type { RepoCatalogEntry } from "./catalog.ts";

/**
 * The sweep: every component the app gives a design, mounted in one render
 * and judged from what the browser drew.
 *
 * A component that appears on a shelf has only been *found*. Whether it
 * renders — with its stylesheet, inside the preview entry, with its variants
 * landing — is established one at a time otherwise, halfway through a design,
 * when a card comes out unstyled. This asks the question for all of them up
 * front. It is a pure plan and a pure verdict on purpose: the render and the
 * browser belong to the caller.
 */

type Css = Record<string, string | number>;

interface Look {
  tw: string;
  css: Css;
}

type VariantPair = { prop: string; values: [string | number, string | number] };

/** One thing to mount: a component of the app's own, or a library one its files back. */
export interface SweepTarget {
  /** What the report calls it — the id an agent composes with. */
  id: string;
  /** The id the mount files this component's diagnostic under. */
  key: string;
  /** One instance. Its root is the component when `variant` is set. */
  node: Node;
  /** A prop to mount two values of, the app's own value first. */
  variant?: VariantPair | undefined;
  /**
   * Props the instance goes without: ones its call site passes as code, and
   * ones the component requires that no call site gave as data.
   */
  missing: string[];
  /**
   * Its children are a text stand-in: the app gives it elements, and no call
   * site spelled them as data. A `Tooltip` rejects text, a `Timeline` clones
   * its items — neither says anything about the canvas.
   */
  placeholder?: boolean | undefined;
  /**
   * The app never renders it by itself — it is on the shelf because a part of
   * it is used (`ScrollArea.Autosize`) — so there is no call site to mount it
   * the way of.
   */
  unused?: boolean | undefined;
}

interface SweepCell {
  target: SweepTarget;
  /** `data-node-path` of each instance's wrapper, in mount order. */
  paths: string[];
}

export interface SweepPlan {
  screen: Screen;
  cells: SweepCell[];
}

/** A prop named like a look, before one named like a size: the first is what a stylesheet carries. */
const VARIANT_NAMES = /^(variant|tone|color|colour|kind|intent|status|appearance|cap|severity)$/i;

/**
 * The variant prop worth mounting twice, given the value an instance already
 * has for it. `namedOnly` takes nothing but a prop named like a look: a
 * library's descriptor lists options (`size`, `orientation`) an app's own
 * copy of the file may predate, and those would read as a missing stylesheet.
 */
export function variantPair(
  props: readonly PropDescriptor[],
  own: Record<string, unknown>,
  namedOnly = false,
): VariantPair | undefined {
  const enums = props.filter(
    (prop) =>
      prop.control === "enum" &&
      (prop as { serializable?: boolean }).serializable !== false &&
      (prop.enumValues?.length ?? 0) >= 2,
  );
  const prop = enums.find((p) => VARIANT_NAMES.test(p.name)) ?? (namedOnly ? undefined : enums[0]);
  const [first, second] = prop?.enumValues ?? [];
  if (!prop || first === undefined || second === undefined) return undefined;
  const mine = own[prop.name];
  if (typeof mine !== "string" && typeof mine !== "number") {
    return { prop: prop.name, values: [first, second] };
  }
  return { prop: prop.name, values: [mine, first === mine ? second : first] };
}

/**
 * The call site to mount. One that passed no code is the app's own picture of
 * the component. What it restyled is left behind: a `className` is the
 * component dressed for where that call site sits — a chip in paper-on-ink for
 * a dark rail is invisible anywhere else — and what is being looked at here is
 * the component's own look.
 */
export function callSiteProps(entry: RepoCatalogEntry): {
  props: Record<string, unknown>;
  missing: string[];
  placeholder: boolean;
} {
  const plain = (s: { props: Record<string, unknown> }) =>
    !("className" in s.props) && !("style" in s.props);
  const complete = entry.states.filter((state) => !state.dropped?.length);
  const state = complete.find(plain) ?? complete[0] ?? entry.states[0];
  const { className: _className, style: _style, ...props } = { ...(state?.props ?? {}) };
  const placeholder = entry.acceptsChildren && props.children === undefined;
  if (placeholder) props.children = entry.name;
  const required = entry.props
    .filter((prop) => !prop.optional && prop.name !== "children" && !(prop.name in props))
    .map((prop) => prop.name);
  return {
    props,
    missing: [...new Set([...(state?.dropped ?? []), ...required])],
    placeholder,
  };
}

/**
 * The roots worth mounting: the app's own files first, then by use. Parts are
 * left out. A dotted one (`Tabs.List`) or a flat-named one (`CommandInput`)
 * outside its root throws for a reason that is not a finding, and inside it
 * is seen wherever the root is.
 */
export function sweepTargets(
  blocks: readonly RepoCatalogEntry[],
  app: string | undefined,
): RepoCatalogEntry[] {
  const local = (entry: RepoCatalogEntry) => (entry.source === "local" ? 0 : 1);
  // A chart library's `XAxis` or `Bar` draws nothing outside a chart, and a
  // devtools panel nothing until it is opened: mounted alone they are a row of
  // "blank" findings every reader has to explain away. The app's own chart
  // components, which hold them, are swept like any other.
  const standalone = (entry: RepoCatalogEntry) =>
    entry.source !== "package" ||
    !(isChartLibrary(entry.packageName ?? "") || /Devtools$/.test(entry.name));
  return blocks
    .filter(
      (entry) =>
        (entry.identity.app ?? undefined) === app &&
        !entry.identity.member &&
        !entry.viaFamily &&
        !entry.partOf &&
        standalone(entry),
    )
    .sort(
      (a, b) =>
        local(a) - local(b) ||
        b.provenance.length - a.provenance.length ||
        b.states.length - a.states.length ||
        a.id.localeCompare(b.id),
    );
}

export function repoSweepTarget(entry: RepoCatalogEntry): SweepTarget {
  const { props, missing, placeholder } = callSiteProps(entry);
  return {
    id: entry.id,
    key: entry.key,
    node: { $ref: entry.name, $repo: entry.identity, props },
    // Only where the app wrote the variants. A package declares options that
    // do nothing on the root alone (`Tabs variant` styles its list, `Grid
    // justify` its children), and mounted twice they read as a stylesheet
    // that never loaded — seven of those on one Mantine app.
    variant: entry.source === "local" ? variantPair(entry.props, props) : undefined,
    missing,
    ...(placeholder ? { placeholder } : {}),
    ...(entry.provenance.length === 0 && entry.states.length === 0 ? { unused: true } : {}),
  };
}

const withProp = (node: Node, prop: string, value: string | number): Node =>
  typeof node === "object" && node !== null && "$ref" in node
    ? { ...node, props: { ...(node.props ?? {}), [prop]: value } }
    : node;

export function planSweep(
  targets: readonly SweepTarget[],
  opts: { element: string; channel: StyleChannel },
): SweepPlan {
  const tailwind = opts.channel.kind === "tailwind-classname";
  const el = (look: Look, content?: string | Node[]): ComponentNode => ({
    $ref: opts.element,
    props: {
      [opts.channel.prop]: tailwind ? look.tw : look.css,
      ...(typeof content === "string" ? { children: content } : {}),
    },
    ...(Array.isArray(content) && content.length > 0 ? { children: content } : {}),
  });

  const cells: SweepCell[] = [];
  const cellNodes: Node[] = [];
  for (const [at, target] of targets.entries()) {
    const { variant } = target;
    const instances = variant
      ? variant.values.map((value) => withProp(target.node, variant.prop, value))
      : [target.node];
    cells.push({ target, paths: instances.map((_, i) => `${at}.1.${i}`) });
    cellNodes.push(
      el(
        {
          tw: "flex max-h-96 min-w-0 flex-col gap-2 overflow-hidden",
          css: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            minWidth: 0,
            maxHeight: "384px",
            overflow: "hidden",
          },
        },
        [
          el(
            {
              tw: "font-mono text-xs text-muted-foreground",
              css: {
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                fontSize: "12px",
                color: "var(--color-muted-foreground)",
              },
            },
            target.id,
          ),
          // A column each, of a definite width: a chart or a `w-full` table
          // sizes itself to its container, and has none inside a shrink-wrap.
          el(
            {
              tw: instances.length > 1 ? "grid grid-cols-2 items-start gap-4" : "grid grid-cols-1",
              css: {
                display: "grid",
                gridTemplateColumns: `repeat(${instances.length}, minmax(0, 1fr))`,
                alignItems: "start",
                gap: "16px",
              },
            },
            instances.map((instance) =>
              // The transform makes the wrapper the containing block for a
              // component that pins itself to the viewport (a sidebar, a
              // toast), so it is drawn in its own cell.
              el(
                {
                  tw: "min-w-0 [transform:translateZ(0)]",
                  css: { minWidth: 0, transform: "translateZ(0)" },
                },
                [instance],
              ),
            ),
          ),
        ],
      ),
    );
  }
  return {
    screen: {
      id: "component-sweep",
      name: "Component sweep",
      tree: el(
        {
          tw: "grid grid-cols-2 gap-8 bg-background p-8 font-sans text-foreground",
          css: {
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "32px",
            padding: "32px",
            background: "var(--color-background)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-sans, system-ui, sans-serif)",
          },
        },
        cellNodes,
      ),
    },
    cells,
  };
}

/** One element the browser drew, as the sweep needs it (a subset of the renderer's `DomNode`). */
export interface DrawnNode {
  depth: number;
  tag: string;
  text?: string | undefined;
  rect: { x: number; y: number; w: number; h: number };
  style: Record<string, string>;
  nodePath?: string | undefined;
}

/** A mount diagnostic, keyed by the component's mount id. */
export interface SweepDiagnostic {
  id: string;
  status: string;
  code?: string | undefined;
  note?: string | undefined;
  remedy?: string | undefined;
}

type SweepFlag = "blank" | "thin" | "variantsIdentical";

interface SweepFinding {
  id: string;
  status: string;
  code?: string | undefined;
  note?: string | undefined;
  remedy?: string | undefined;
  flags?: SweepFlag[] | undefined;
  /** What a flag means for this component, in words. */
  detail?: string | undefined;
  /** Size of the first instance as drawn. */
  size?: { w: number; h: number } | undefined;
}

export interface SweepVerdict {
  checked: number;
  ok: string[];
  problems: SweepFinding[];
  /** Went without props it needs — a verdict on the props, not the component. */
  inconclusive: SweepFinding[];
}

const HEALTHY = new Set(["exact", "adapted"]);
const THIN_PX = 4;

interface Drawn {
  size: { w: number; h: number };
  signature: string;
}

/** Everything drawn beneath the wrapper at `path`: its extent and what it looks like. */
function drawnUnder(nodes: readonly DrawnNode[], path: string): Drawn | null {
  const at = nodes.findIndex((node) => node.nodePath === path);
  const wrapper = nodes[at];
  if (!wrapper) return null;
  const inside: DrawnNode[] = [];
  for (const node of nodes.slice(at + 1)) {
    if (node.depth <= wrapper.depth) break;
    inside.push(node);
  }
  if (inside.length === 0) {
    // A component that renders text and no element (a context provider around
    // its children) drew something: the wrapper holds the text itself.
    if (!wrapper.text || wrapper.rect.h === 0) return null;
    return {
      size: { w: Math.round(wrapper.rect.w), h: Math.round(wrapper.rect.h) },
      signature: `text:${JSON.stringify(wrapper.style)}`,
    };
  }
  const left = Math.min(...inside.map((n) => n.rect.x));
  const top = Math.min(...inside.map((n) => n.rect.y));
  const right = Math.max(...inside.map((n) => n.rect.x + n.rect.w));
  const bottom = Math.max(...inside.map((n) => n.rect.y + n.rect.h));
  return {
    size: { w: Math.round(right - left), h: Math.round(bottom - top) },
    // Position is left out: two instances sit side by side. Text is left out
    // too — a variant changes how a thing looks, and that is what is compared.
    signature: inside
      .map(
        (n) =>
          `${n.depth - wrapper.depth}:${n.tag}:${Math.round(n.rect.w)}x${Math.round(n.rect.h)}:${JSON.stringify(n.style)}`,
      )
      .join("|"),
  };
}

export function judgeSweep(
  plan: Pick<SweepPlan, "cells">,
  nodes: readonly DrawnNode[],
  diagnostics: readonly SweepDiagnostic[],
): SweepVerdict {
  const byKey = new Map(diagnostics.map((entry) => [entry.id, entry]));
  const verdict: SweepVerdict = {
    checked: plan.cells.length,
    ok: [],
    problems: [],
    inconclusive: [],
  };
  for (const { target, paths } of plan.cells) {
    const diagnostic = byKey.get(target.key);
    const status = diagnostic?.status ?? "unchecked";
    const finding: SweepFinding = {
      id: target.id,
      status,
      ...(diagnostic?.code ? { code: diagnostic.code } : {}),
      ...(diagnostic?.note ? { note: diagnostic.note } : {}),
      ...(diagnostic?.remedy ? { remedy: diagnostic.remedy } : {}),
    };
    // What the instance went without, in words: props, and real children.
    const props = target.missing.map((name) => `\`${name}\``).join(", ");
    const several = target.missing.length > 1;
    const without = [
      ...(target.missing.length > 0
        ? [
            `without ${props} (the app passes ${several ? "them" : "it"} as code, or the component requires ${several ? "them" : "it"})`,
          ]
        : []),
      ...(target.placeholder
        ? ["with a line of text for `children`, where the app gives it elements"]
        : []),
      ...(target.unused && !target.placeholder
        ? ["with no props at all, since the app never renders it by itself"]
        : []),
    ].join(" and ");
    if (!HEALTHY.has(status)) {
      // Whatever the mount guessed the cause was, a component that went without
      // props it needs has not been tested yet. One that only lacked real
      // children is untested when it simply threw — a named cause (a missing
      // provider) is still a finding.
      const untested =
        target.missing.length > 0 || (target.placeholder && diagnostic?.code === "render-threw");
      if (untested && status !== "unchecked") {
        verdict.inconclusive.push({
          id: target.id,
          status,
          detail: `Mounted ${without}, and it did not render${diagnostic?.note ? ` (${diagnostic.note.slice(0, 140)})` : ""}. That is a verdict on what it was given, not on the component: compose it the way the app does before reading this as broken.`,
        });
      } else {
        verdict.problems.push(finding);
      }
      continue;
    }
    const drawn = paths.map((path) => drawnUnder(nodes, path));
    const first = drawn[0];
    const sliver =
      first !== null &&
      first !== undefined &&
      // Nothing in one dimension, or next to nothing in both. A rule drawn
      // one pixel high across its column is a separator doing its job.
      (first.size.w < 1 || first.size.h < 1 || (first.size.w < THIN_PX && first.size.h < THIN_PX));
    const flags: SweepFlag[] = [];
    const details: string[] = [];
    if ((!first || sliver) && without !== "") {
      verdict.inconclusive.push({
        id: target.id,
        status,
        detail: `Mounted ${without}, and it drew ${first ? `${first.size.w}×${first.size.h}px` : "nothing"} — which may be all it does given that.`,
      });
      continue;
    }
    if (!first) {
      flags.push("blank");
      details.push(
        "It mounted and drew nothing visible with the props its call site passes. A dialog or drawer that is closed until opened does that by design; anything else may need data, children or a provider it reads for itself.",
      );
    } else if (sliver) {
      flags.push("thin");
      details.push(
        `It drew ${first.size.w}×${first.size.h}px — a sliver, usually content it was not given or a stylesheet that did not load.`,
      );
    }
    const [a, b] = drawn;
    if (target.variant && a && b && a.signature === b.signature) {
      const [one, other] = target.variant.values;
      flags.push("variantsIdentical");
      details.push(
        `\`${target.variant.prop}="${one}"\` and \`${target.variant.prop}="${other}"\` draw the same thing. Unless those two are meant to look alike, the styles for the variant are not reaching the canvas. Two usual causes: a stylesheet the preview entry doesn't load (preview_status), or classes the app's own Tailwind config defines — a custom colour such as \`bg-brand\` exists here only once the theme has that colour (import_theme, or set_theme with a custom role).`,
      );
    }
    if (flags.length === 0) {
      verdict.ok.push(target.id);
      continue;
    }
    verdict.problems.push({
      ...finding,
      flags,
      detail: details.join(" "),
      ...(first ? { size: first.size } : {}),
    });
  }
  return verdict;
}
