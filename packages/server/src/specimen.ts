import {
  COMPONENT_GROUPS,
  type ComponentDescriptor,
  type ComponentGroup,
  type FrameworkAdapter,
  type Manifest,
  type StyleChannel,
  styleChannelOf,
  UNGROUPED_LABEL,
} from "@velloo/provider";
import { $, DoAsync, type Result } from "@velloo/result";
import { type ComponentNode, isComponentNode, type Node, type Theme } from "@velloo/schema";
import { buildShowcaseTree, showcaseIds } from "./library/showcases.ts";
import type { MutationContext } from "./mutations/context.ts";
import type { MutationError } from "./mutations/errors.ts";
import { addBoard, addFrame, addScreen, setScreenTree, updateFrames } from "./mutations/index.ts";

/**
 * The specimen: one screen that shows a design language on the folder's own
 * components — the roles, the type ladder, the corner scale, then real
 * instances from each shelf of the library.
 *
 * It states no token value. Everything on it resolves through the theme at
 * render time, so a colour or a face changed afterwards changes the specimen
 * too, and it can never disagree with the design it describes.
 */

export const SPECIMEN_ID = "design-language";
const SPECIMEN_NAME = "Design language";

type Css = Record<string, string | number>;

/** One node's styling, said twice: the folder's channel picks which is written. */
interface Look {
  tw: string;
  css: Css;
}

const color = (role: string) => `var(--color-${role})`;
const RADIUS = "var(--radius, 8px)";
const MONO = "var(--font-mono, ui-monospace, monospace)";

/** Display order for the roles a theme defines; pairs carry a foreground. */
const COLOR_ROLES: ReadonlyArray<{ role: keyof Theme["colors"]; pair: boolean }> = [
  { role: "background", pair: false },
  { role: "foreground", pair: false },
  { role: "primary", pair: true },
  { role: "secondary", pair: true },
  { role: "accent", pair: true },
  { role: "muted", pair: true },
  { role: "destructive", pair: true },
  { role: "card", pair: true },
  { role: "popover", pair: true },
  { role: "border", pair: false },
  { role: "input", pair: false },
  { role: "ring", pair: false },
];

const RADII: ReadonlyArray<{ label: string; tw: string; css: string }> = [
  { label: "Small", tw: "rounded-sm", css: `calc(${RADIUS} - 4px)` },
  { label: "Medium", tw: "rounded-md", css: `calc(${RADIUS} - 2px)` },
  { label: "Large", tw: "rounded-lg", css: RADIUS },
  { label: "Extra large", tw: "rounded-xl", css: `calc(${RADIUS} + 4px)` },
];

/** The shelves worth a row: what a design language visibly restyles. */
const SPECIMEN_SHELVES: ReadonlySet<ComponentGroup> = new Set([
  "actions",
  "forms",
  "display",
  "feedback",
  "navigation",
]);
const PER_SHELF = 6;
const UNSHELVED_LIMIT = 12;

const SAMPLE = "The quick brown fox jumps over the lazy dog";

interface SpecimenInput {
  name: string;
  theme: Theme;
  manifest: Manifest;
  channel: StyleChannel;
  /** The library's plain-element component (`FrameworkAdapter.elementComponent`). */
  element: string;
}

function buildSpecimenTree(input: SpecimenInput): ComponentNode {
  const { channel, element, manifest, theme } = input;
  const known = new Set(manifest.map((d) => d.id));
  const tailwind = channel.kind === "tailwind-classname";

  const el = (as: string, look: Look, content?: string | Node[], id?: string): ComponentNode => ({
    $ref: element,
    ...(id ? { $id: id } : {}),
    props: {
      as,
      [channel.prop]: tailwind ? look.tw : look.css,
      ...(typeof content === "string" ? { children: content } : {}),
    },
    ...(Array.isArray(content) && content.length > 0 ? { children: content } : {}),
  });

  const caption = (text: string): ComponentNode =>
    el(
      "span",
      {
        tw: "text-xs text-muted-foreground",
        css: { fontSize: "12px", color: color("muted-foreground") },
      },
      text,
    );

  const section = (id: string, title: string, note: string, body: Node[]): ComponentNode =>
    el(
      "section",
      { tw: "flex flex-col gap-5", css: { display: "flex", flexDirection: "column", gap: "20px" } },
      [
        el(
          "div",
          {
            tw: "flex items-baseline gap-3 border-b border-border pb-2",
            css: {
              display: "flex",
              alignItems: "baseline",
              gap: "12px",
              borderBottom: `1px solid ${color("border")}`,
              paddingBottom: "8px",
            },
          },
          [
            el(
              "span",
              {
                tw: "text-xs font-semibold uppercase tracking-widest text-muted-foreground",
                css: {
                  fontSize: "12px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: color("muted-foreground"),
                },
              },
              title,
            ),
            caption(note),
          ],
        ),
        ...body,
      ],
      id,
    );

  const swatch = ({ role, pair }: (typeof COLOR_ROLES)[number]): ComponentNode =>
    el(
      "div",
      { tw: "flex flex-col gap-2", css: { display: "flex", flexDirection: "column", gap: "8px" } },
      [
        el(
          "div",
          {
            tw: `flex h-16 items-end rounded-lg border border-border p-2 text-sm font-medium bg-${role}${pair ? ` text-${role}-foreground` : ""}`,
            css: {
              display: "flex",
              alignItems: "flex-end",
              height: "64px",
              padding: "8px",
              fontSize: "14px",
              fontWeight: 500,
              borderRadius: RADIUS,
              border: `1px solid ${color("border")}`,
              background: color(role),
              ...(pair ? { color: color(`${role}-foreground`) } : {}),
            },
          },
          pair ? "Aa" : undefined,
        ),
        caption(role),
      ],
    );

  const rung = (label: string, sample: Node): ComponentNode =>
    el(
      "div",
      {
        tw: "flex items-baseline gap-6",
        css: { display: "flex", alignItems: "baseline", gap: "24px" },
      },
      [
        el(
          "span",
          {
            tw: "w-14 shrink-0 font-mono text-xs text-muted-foreground",
            css: {
              width: "56px",
              flexShrink: 0,
              fontFamily: MONO,
              fontSize: "12px",
              color: color("muted-foreground"),
            },
          },
          label,
        ),
        sample,
      ],
    );

  // The helpers carry the typeset's ladder; a library without them still gets
  // its headings as real heading elements, in whatever its own CSS gives them.
  const heading = (level: number): Node =>
    known.has("Heading")
      ? { $ref: "Heading", props: { level, children: SAMPLE } }
      : el(`h${level}`, { tw: "m-0", css: { margin: 0 } }, SAMPLE);
  const copy = (variant: string): Node =>
    known.has("Text")
      ? { $ref: "Text", props: { variant, children: SAMPLE } }
      : el("p", { tw: "m-0", css: { margin: 0 } }, SAMPLE);

  const roles = COLOR_ROLES.filter(({ role }) => theme.colors[role] !== undefined);
  const shelves = [
    ...COMPONENT_GROUPS.filter((g) => SPECIMEN_SHELVES.has(g.id)).map((g) => ({
      label: g.label,
      instances: shelfInstances(manifest, g.id, known, tailwind),
    })),
    { label: UNGROUPED_LABEL, instances: shelfInstances(manifest, undefined, known, tailwind) },
  ].filter((shelf) => shelf.instances.length > 0);

  return el(
    "div",
    {
      tw: "flex min-h-screen flex-col gap-12 bg-background p-10 font-sans text-foreground",
      css: {
        display: "flex",
        flexDirection: "column",
        gap: "48px",
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: "40px",
        background: color("background"),
        color: color("foreground"),
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      },
    },
    [
      el(
        "div",
        {
          tw: "flex flex-col gap-1",
          css: { display: "flex", flexDirection: "column", gap: "4px" },
        },
        [
          el(
            "span",
            {
              tw: "text-2xl font-semibold tracking-tight",
              css: { fontSize: "24px", fontWeight: 600, letterSpacing: "-0.025em" },
            },
            input.name,
          ),
          caption("Design language — colour, type and shape as this design renders them."),
        ],
      ),
      section("colour", "Colour", "Every role the theme defines, with its text colour on top.", [
        el(
          "div",
          {
            tw: "grid grid-cols-6 gap-4",
            css: { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "16px" },
          },
          roles.map(swatch),
        ),
      ]),
      section("type", "Type", "The ladder the typeset computes, on the faces the theme names.", [
        el(
          "div",
          {
            tw: "flex flex-col gap-4",
            css: { display: "flex", flexDirection: "column", gap: "16px" },
          },
          [
            ...[1, 2, 3, 4].map((level) => rung(`h${level}`, heading(level))),
            rung("lead", copy("lead")),
            rung("body", copy("default")),
            rung("small", copy("small")),
          ],
        ),
      ]),
      section("shape", "Shape", "The corner scale, from the theme's radius.", [
        el(
          "div",
          {
            tw: "grid grid-cols-4 gap-4",
            css: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "16px" },
          },
          RADII.map((r) =>
            el(
              "div",
              {
                tw: "flex flex-col gap-2",
                css: { display: "flex", flexDirection: "column", gap: "8px" },
              },
              [
                el("div", {
                  tw: `h-20 border border-border bg-muted ${r.tw}`,
                  css: {
                    height: "80px",
                    border: `1px solid ${color("border")}`,
                    background: color("muted"),
                    borderRadius: r.css,
                  },
                }),
                caption(r.label),
              ],
            ),
          ),
        ),
      ]),
      ...(shelves.length > 0
        ? [
            section(
              "components",
              "Components",
              "Real instances from this design's library, a few from each shelf.",
              shelves.map((shelf) =>
                el(
                  "div",
                  {
                    tw: "flex flex-col gap-3",
                    css: { display: "flex", flexDirection: "column", gap: "12px" },
                  },
                  [
                    caption(shelf.label),
                    el(
                      "div",
                      {
                        tw: "flex flex-wrap items-start gap-6",
                        css: {
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "flex-start",
                          gap: "24px",
                        },
                      },
                      // A cell per instance: a component that fills its parent
                      // (an input, an alert) is shown at a column's width
                      // rather than stretched across the page.
                      shelf.instances.map((instance) =>
                        el(
                          "div",
                          { tw: "min-w-0 max-w-sm", css: { minWidth: 0, maxWidth: "384px" } },
                          [instance],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ]
        : []),
    ],
    "specimen",
  );
}

function refsOf(node: Node, out: string[] = []): string[] {
  if (!isComponentNode(node)) return out;
  out.push(node.$ref);
  for (const child of node.children ?? []) refsOf(child, out);
  return out;
}

/** Tailwind classes mean nothing on the other channels; drop them rather than leave inert strings. */
function withoutClassNames(node: Node): Node {
  if (!isComponentNode(node)) return node;
  const { className: _dropped, ...props } = node.props ?? {};
  return {
    ...node,
    props,
    ...(node.children ? { children: node.children.map(withoutClassNames) } : {}),
  };
}

/**
 * One working instance of a component, or null when nothing says how to build
 * one. A hand-built showcase is used only if this library has every part it
 * names; after that the manifest's own `example`. A bare label is the last
 * resort, and only where `allowLabel` says the caller can vouch for it.
 */
function instanceOf(
  descriptor: ComponentDescriptor,
  known: ReadonlySet<string>,
  tailwind: boolean,
  handBuilt: ReadonlySet<string>,
  allowLabel: boolean,
): Node | null {
  if (handBuilt.has(descriptor.id)) {
    const tree = buildShowcaseTree(descriptor.id);
    if (refsOf(tree).every((ref) => known.has(ref)))
      return tailwind ? tree : withoutClassNames(tree);
  }
  if (descriptor.example) return { $ref: descriptor.id, props: { ...descriptor.example } };
  const takesChildren = descriptor.props.some((p) => p.name === "children");
  if (allowLabel && takesChildren)
    return { $ref: descriptor.id, props: { children: descriptor.id } };
  return null;
}

/**
 * A few instances from one shelf — or, with no `group`, from the components a
 * library files under none (only shadcn's manifest carries shelves today).
 * Those get no label fallback: without `family` there is no telling a leaf
 * from a compound root, and a compound one given a string for children renders
 * as stray text.
 */
function shelfInstances(
  manifest: Manifest,
  group: ComponentGroup | undefined,
  known: ReadonlySet<string>,
  tailwind: boolean,
): Node[] {
  const handBuilt = new Set(showcaseIds());
  const limit = group === undefined ? UNSHELVED_LIMIT : PER_SHELF;
  const out: Node[] = [];
  for (const descriptor of manifest) {
    if (out.length >= limit) break;
    if (descriptor.group !== group || descriptor.category !== "ui") continue;
    if (descriptor.family !== undefined && descriptor.family !== descriptor.id) continue;
    const compound = manifest.some((d) => d.family === descriptor.id && d.id !== descriptor.id);
    const allowLabel = group !== undefined && !compound;
    const instance = instanceOf(descriptor, known, tailwind, handBuilt, allowLabel);
    if (instance) out.push(instance);
  }
  return out;
}

export interface SpecimenResult {
  boardId: string;
  screenId: string;
  /** False when the specimen was already there and was left as it stood. */
  built: boolean;
}

const FRAME = { w: 1280, h: 2000, gap: 80 };

/**
 * Put the specimen on its own board, light and dark side by side. A specimen
 * that already exists is left alone unless `rebuild` asks for a fresh one —
 * it is an ordinary screen once made, and someone may have added to it.
 */
export async function ensureSpecimen(
  ctx: MutationContext,
  opts: { rebuild?: boolean | undefined } = {},
): Promise<Result<SpecimenResult, MutationError>> {
  return DoAsync<SpecimenResult, MutationError>(async function* () {
    const provider = ctx.defaultProvider;
    const hasScreen = ctx.folder.screens.has(SPECIMEN_ID);
    let built = false;
    if (!hasScreen || opts.rebuild) {
      const tree = buildSpecimenTree({
        name: ctx.folder.config.name,
        theme: ctx.folder.theme,
        manifest: await provider.loadManifest(),
        channel: styleChannelOf(provider, ctx.folder.config.styling?.framework),
        element: (provider as FrameworkAdapter).elementComponent ?? "Box",
      });
      if (hasScreen) yield* $(await setScreenTree(ctx, { screenId: SPECIMEN_ID, tree }));
      else yield* $(await addScreen(ctx, { id: SPECIMEN_ID, name: SPECIMEN_NAME, tree }));
      built = true;
    }
    if (!ctx.folder.boards.has(SPECIMEN_ID)) {
      yield* $(await addBoard(ctx, { id: SPECIMEN_ID, name: SPECIMEN_NAME }));
      const frames = (["light", "dark"] as const).map((scheme, i) => ({
        id: `${SPECIMEN_ID}-${scheme}`,
        scheme,
        x: i * (FRAME.w + FRAME.gap),
        label: scheme === "light" ? "Light" : "Dark",
      }));
      for (const frame of frames) {
        yield* $(
          await addFrame(ctx, {
            boardId: SPECIMEN_ID,
            screenId: SPECIMEN_ID,
            id: frame.id,
            x: frame.x,
            y: 0,
            w: FRAME.w,
            h: FRAME.h,
            label: frame.label,
          }),
        );
      }
      yield* $(
        await updateFrames(ctx, {
          boardId: SPECIMEN_ID,
          patches: frames.map((frame) => ({ frameId: frame.id, patch: { scheme: frame.scheme } })),
        }),
      );
    }
    return { boardId: SPECIMEN_ID, screenId: SPECIMEN_ID, built };
  });
}
