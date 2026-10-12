import type { StyleChannel } from "@velloo/provider";
import type { ComponentNode, Node, Screen } from "@velloo/schema";
import type { RepoCatalogEntry } from "./catalog.ts";

/**
 * The sweep: every component the app gives a design, mounted once in a single
 * render and judged from what the browser drew.
 *
 * A component that appears on the Repo shelves has only been *found*. Whether
 * it renders — with its stylesheet, inside the preview entry, with its
 * variants landing — is established one at a time otherwise, halfway through a
 * design, when a card comes out unstyled. This asks the question for all of
 * them up front. It is a pure plan and a pure verdict on purpose: the render
 * and the browser belong to the caller.
 */

type Css = Record<string, string | number>;

interface Look {
  tw: string;
  css: Css;
}

export interface SweepInstance {
  /** `data-node-path` of the wrapper the instance is measured through. */
  path: string;
  props: Record<string, unknown>;
}

export interface SweepCell {
  entry: RepoCatalogEntry;
  instances: SweepInstance[];
  /** The variant prop the two instances differ in, when the cell tests one. */
  variant?: { prop: string; values: [string | number, string | number] } | undefined;
  /** Props the app passes as code at the call site the instance was built from. */
  dropped: string[];
}

export interface SweepPlan {
  screen: Screen;
  cells: SweepCell[];
  /** Roots left out because of `limit`, by id. */
  notChecked: string[];
}

export const SWEEP_DEFAULT_LIMIT = 40;

/** A prop named like a look, before one named like a size: the first is what a stylesheet carries. */
const VARIANT_NAMES = /^(variant|tone|color|colour|kind|intent|status|appearance|cap|severity)$/i;

function variantOf(entry: RepoCatalogEntry): SweepCell["variant"] {
  const enums = entry.props.filter(
    (prop) => prop.control === "enum" && prop.serializable && (prop.enumValues?.length ?? 0) >= 2,
  );
  const prop = enums.find((p) => VARIANT_NAMES.test(p.name)) ?? enums[0];
  const [first, second] = prop?.enumValues ?? [];
  if (!prop || first === undefined || second === undefined) return undefined;
  return { prop: prop.name, values: [first, second] };
}

/** The call site to mount: one that passed no code is the app's own picture of the component. */
export function callSiteProps(entry: RepoCatalogEntry): {
  props: Record<string, unknown>;
  dropped: string[];
} {
  const state = entry.states.find((s) => !s.dropped?.length) ?? entry.states[0];
  const props = { ...(state?.props ?? {}) };
  if (entry.acceptsChildren && props.children === undefined) props.children = entry.name;
  return { props, dropped: state?.dropped ?? [] };
}

/**
 * The roots worth mounting, most used first. Compound parts are seen inside
 * their root's own call site, and a part mounted alone (`Tabs.List` outside
 * `Tabs`) throws for a reason that is not a finding.
 */
export function sweepTargets(
  blocks: readonly RepoCatalogEntry[],
  app: string | undefined,
): RepoCatalogEntry[] {
  return blocks
    .filter(
      (entry) =>
        (entry.identity.app ?? undefined) === app && !entry.identity.member && !entry.viaFamily,
    )
    .sort(
      (a, b) =>
        b.provenance.length - a.provenance.length ||
        b.states.length - a.states.length ||
        a.id.localeCompare(b.id),
    );
}

export function planSweep(
  targets: readonly RepoCatalogEntry[],
  opts: { element: string; channel: StyleChannel; limit?: number | undefined },
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

  const limit = opts.limit ?? SWEEP_DEFAULT_LIMIT;
  const cells: SweepCell[] = [];
  const cellNodes: Node[] = [];
  for (const [at, entry] of targets.slice(0, limit).entries()) {
    const base = callSiteProps(entry);
    const variant = variantOf(entry);
    // The app's own value for the variant stays on the first instance; the
    // second takes a different one, so the pair differs in that prop alone.
    const own = variant ? base.props[variant.prop] : undefined;
    const pair: [string | number, string | number] | undefined = variant
      ? own === undefined
        ? variant.values
        : [
            own as string | number,
            variant.values[0] === own ? variant.values[1] : variant.values[0],
          ]
      : undefined;
    const instanceProps = pair
      ? pair.map((value) => ({ ...base.props, [variant?.prop ?? ""]: value }))
      : [base.props];
    const instances = instanceProps.map((props, i) => ({ path: `${at}.1.${i}`, props }));
    cells.push({
      entry,
      instances,
      ...(variant && pair ? { variant: { prop: variant.prop, values: pair } } : {}),
      dropped: base.dropped,
    });
    cellNodes.push(
      el(
        {
          tw: "flex max-h-80 min-w-0 flex-col gap-2 overflow-hidden",
          css: {
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            minWidth: 0,
            maxHeight: "320px",
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
            entry.id,
          ),
          el(
            {
              tw: "flex flex-wrap items-start gap-4",
              css: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "16px" },
            },
            instanceProps.map((props) =>
              // The transform makes the wrapper the containing block for a
              // component that pins itself to the viewport (a sidebar, a
              // toast), so it is drawn in its own cell.
              el(
                {
                  tw: "min-w-0 [transform:translateZ(0)]",
                  css: { minWidth: 0, transform: "translateZ(0)" },
                },
                [{ $ref: entry.name, $repo: entry.identity, props }],
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
    notChecked: targets.slice(limit).map((entry) => entry.id),
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

/** A mount diagnostic, keyed by the component's repo key. */
export interface SweepDiagnostic {
  id: string;
  status: string;
  code?: string | undefined;
  note?: string | undefined;
  remedy?: string | undefined;
}

export type SweepFlag = "blank" | "thin" | "variantsIdentical";

export interface SweepFinding {
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
  /** Threw without the code its call site passes — a verdict on the props, not the component. */
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
  if (inside.length === 0) return null;
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
  for (const cell of plan.cells) {
    const diagnostic = byKey.get(cell.entry.key);
    const status = diagnostic?.status ?? "unchecked";
    const finding: SweepFinding = {
      id: cell.entry.id,
      status,
      ...(diagnostic?.code ? { code: diagnostic.code } : {}),
      ...(diagnostic?.note ? { note: diagnostic.note } : {}),
      ...(diagnostic?.remedy ? { remedy: diagnostic.remedy } : {}),
    };
    if (!HEALTHY.has(status)) {
      if (diagnostic?.code === "render-threw" && cell.dropped.length > 0) {
        verdict.inconclusive.push({
          ...finding,
          detail: `Mounted without ${cell.dropped.map((name) => `\`${name}\``).join(", ")}, which the app passes as code, and it threw on that. Place it with those props filled in before reading this as broken.`,
        });
      } else {
        verdict.problems.push(finding);
      }
      continue;
    }
    const drawn = cell.instances.map((instance) => drawnUnder(nodes, instance.path));
    const first = drawn[0];
    const flags: SweepFlag[] = [];
    const details: string[] = [];
    if (!first) {
      flags.push("blank");
      details.push(
        "It mounted and drew nothing visible with the props its call site passes — it may need data, children or a provider it reads for itself.",
      );
    } else if (first.size.w < THIN_PX || first.size.h < THIN_PX) {
      flags.push("thin");
      details.push(
        `It drew ${first.size.w}×${first.size.h}px — a sliver, usually content it was not given or a stylesheet that did not load.`,
      );
    }
    const [a, b] = drawn;
    if (cell.variant && a && b && a.signature === b.signature) {
      const [one, other] = cell.variant.values;
      flags.push("variantsIdentical");
      details.push(
        `\`${cell.variant.prop}="${one}"\` and \`${cell.variant.prop}="${other}"\` draw the same thing. Unless those two are meant to look alike, the styles for the variant are not reaching the canvas. Two usual causes: a stylesheet the preview entry doesn't load (preview_status), or classes the app's own Tailwind config defines — a custom colour such as \`bg-brand\` exists here only once the theme has that colour (import_theme, or set_theme with a custom role).`,
      );
    }
    if (flags.length === 0) {
      verdict.ok.push(cell.entry.id);
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
