/**
 * What the HUD offers for a given node.
 *
 * The bar is contextual: it shows the handful of controls that apply to what
 * you selected and nothing else. That means someone has to decide, per kind of
 * node, which controls those are — and a wrong guess hides a control with no
 * way to reach it. The decision here is to hand-curate only the things people
 * actually select (headings, text, boxes, images, icons), take a snippet
 * instance's set straight from its declared `params`, and give everything else
 * one sensible fallback rather than a per-component opinion.
 *
 * Deliberately absent: `display`, `position`, `flex-direction`, `justify`,
 * `align-items`, `overflow`, `z-index`, and the raw class string. Those are the
 * agent's job. The vocabulary names outcomes where an outcome name is clearer
 * than the property — *Fill / Hug / Fixed*, *Corners* — and the property where
 * it isn't: *Padding*, *Margin* and *Gap* are what every design tool calls the
 * three spacings, and the invented *Inside / Outside / Between* only made the
 * reader translate.
 */

import type { ComponentDescriptor } from "@velloo/provider";
import type { Node, Snippet, SnippetParam, Theme } from "@velloo/schema";
import { isComponentNode, isSnippetInstance } from "@velloo/schema";

/** How a control renders and what gesture drives it. */
type ControlKind =
  | "size" // Fill / Hug / Fixed, with a px value when fixed
  | "number" // scrubbable px value
  | "ratio" // scrubbable unitless value (line height)
  | "choice" // named options
  | "align" // left / center / right
  | "color" // theme token picker
  | "font" // theme font role
  | "icon" // lucide glyph picker
  | "text" // short single-line string
  | "prompt" // too long for the bar; opens a dialog
  | "toggle";

/** The slots of the style model the HUD is willing to touch. */
export type StyleKey =
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "leading"
  | "tracking"
  | "textAlign"
  | "textColor"
  | "bg"
  | "rounded"
  | "borderWidth"
  | "borderColor"
  | "width"
  | "height"
  | "padding"
  | "margin"
  | "gap";

/** Where a control reads and writes. */
type Slot =
  | { readonly via: "style"; readonly key: StyleKey }
  | { readonly via: "prop"; readonly name: string }
  | { readonly via: "arg"; readonly name: string };

export interface Choice {
  readonly value: string;
  readonly label: string;
  /** A CSS colour to paint for this option, for colour choices. */
  readonly swatch?: string | undefined;
}

/**
 * Where a control is allowed to appear.
 *
 * The bar is horizontal and sits over the drawing, so its budget is a handful
 * of fields — past that everything shrinks until a width reads one digit. So
 * each control declares whether it earns bar space; the pane always shows all
 * of them. A control demoted to `pane` is never hidden, only moved.
 */
type Tier = "bar" | "pane";

export interface ControlSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: ControlKind;
  readonly slot: Slot;
  readonly tier: Tier;
  /** Bar width in px — the bar is horizontal and space is the scarce resource. */
  readonly width: number;
  readonly choices?: readonly Choice[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** The bar's half of a resolved set. */
export function barControls(controls: readonly ControlSpec[]): readonly ControlSpec[] {
  return controls.filter((c) => c.tier === "bar");
}

/**
 * What kind of thing is selected. Drives which curated set applies — not the
 * same as the component id, since a `Box` is a heading, a paragraph, or a
 * container depending on how it's used.
 */
export type NodeRole = "heading" | "text" | "box" | "image" | "icon" | "snippet" | "other";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const TEXT_TAGS = new Set([
  "p",
  "span",
  "small",
  "strong",
  "em",
  "b",
  "i",
  "label",
  "blockquote",
  "figcaption",
  "li",
  "dt",
  "dd",
]);

/** Components that are containers whatever they hold. */
const BOX_REFS = new Set([
  "Box",
  "Card",
  "CardContent",
  "CardHeader",
  "CardFooter",
  "Container",
  "Stack",
  "Layer",
  "Placeholder",
]);

/**
 * Classify a node. `Box` is the ambiguous one — velloo screens use it as every
 * text primitive via `as`, so the tag and the shape of `children` decide.
 */
export function roleOf(node: Node): NodeRole {
  if (isSnippetInstance(node)) return "snippet";
  if (!isComponentNode(node)) return "other";

  const ref = node.$ref;
  if (ref === "Image") return "image";
  if (ref === "Icon") return "icon";
  if (ref === "Heading") return "heading";
  if (ref === "Text") return "text";

  if (ref === "Box") {
    const as = typeof node.props?.as === "string" ? node.props.as : undefined;
    if (as && HEADING_TAGS.has(as)) return "heading";
    if (as && TEXT_TAGS.has(as)) return "text";
    // A Box whose whole content is a string is a text run, however it's tagged.
    if (typeof node.props?.children === "string") return "text";
    return "box";
  }

  return BOX_REFS.has(ref) ? "box" : "other";
}

// ------------------------------------------------------------- vocabularies

const SIZE_CHOICES: readonly Choice[] = [
  { value: "full", label: "Fill" },
  { value: "fit", label: "Hug" },
  { value: "fixed", label: "Fixed" },
];

const WEIGHT_CHOICES: readonly Choice[] = [
  { value: "light", label: "Light" },
  { value: "normal", label: "Regular" },
  { value: "medium", label: "Medium" },
  { value: "semibold", label: "Semibold" },
  { value: "bold", label: "Bold" },
];

const CORNER_CHOICES: readonly Choice[] = [
  { value: "none", label: "Square" },
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "full", label: "Round" },
];

const ALIGN_CHOICES: readonly Choice[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

/**
 * Tailwind spells a 1px border as bare `border` — an empty argument, which a
 * select can't carry (an empty value means "nothing chosen"). `"1"` stands in
 * for it here and the style model translates at the boundary.
 */
const BORDER_CHOICES: readonly Choice[] = [
  { value: "0", label: "None" },
  { value: "1", label: "Hairline" },
  { value: "2", label: "Medium" },
  { value: "4", label: "Thick" },
];

const TRACKING_CHOICES: readonly Choice[] = [
  { value: "tighter", label: "Tighter" },
  { value: "tight", label: "Tight" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
  { value: "wider", label: "Wider" },
];

/** A theme colour slot is either a bare CSS colour or a DEFAULT/foreground pair. */
type ColorSlot = string | { DEFAULT?: string; foreground?: string } | undefined;

/**
 * The CSS colour a style token actually paints, read from the *design* theme.
 *
 * Swatches used to be `var(--color-<token>)`, which resolves against whichever
 * document renders them — in the canvas that's the velloo app's own stylesheet,
 * so a design whose primary is blue drew the app's orange. The theme is in the
 * store; ask it instead.
 */
export function resolveColorToken(
  theme: Theme | null | undefined,
  token: string | null | undefined,
): string | null {
  if (!token) return null;
  // An arbitrary value — `[#7c3aed]` — is already a colour, and so is the bare
  // hex a computed default arrives as.
  if (token.startsWith("[")) return token.slice(1, -1);
  if (token.startsWith("#")) return token;
  if (!theme) return null;
  // `primary/10` is the token at an opacity; the opacity isn't part of the name.
  const bare = token.split("/")[0] ?? token;
  const colors = theme.colors as unknown as Record<string, ColorSlot>;

  const direct = colors[bare];
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object") return direct.DEFAULT ?? null;

  const paired = /^(.*)-foreground$/.exec(bare);
  if (paired) {
    const slot = colors[paired[1] ?? ""];
    if (slot && typeof slot === "object") return slot.foreground ?? null;
  }

  // A host app's own scale (`primary-600`, `brand-teal`) lives in `palette`.
  return theme.palette?.[bare] ?? null;
}

/**
 * Theme colour tokens, flattened. A group like `primary: { DEFAULT, foreground }`
 * contributes both `primary` and `primary-foreground`, matching the Tailwind
 * argument the style model stores.
 */
export function colorChoices(theme: Theme | null | undefined): readonly Choice[] {
  if (!theme) return [];
  const out: Choice[] = [];
  const add = (value: string, label: string) => {
    const swatch = resolveColorToken(theme, value);
    out.push({ value, label, ...(swatch === null ? {} : { swatch }) });
  };
  for (const [name, value] of Object.entries(theme.colors)) {
    if (value === null || value === undefined) continue;
    add(name, humanize(name));
    if (typeof value === "object" && "foreground" in value && value.foreground !== undefined) {
      add(`${name}-foreground`, `${humanize(name)} text`);
    }
  }
  return out;
}

/** Theme font roles (`sans`, `mono`, `display`, …) — never a raw family. */
export function fontChoices(theme: Theme | null | undefined): readonly Choice[] {
  const families = theme?.typography?.fontFamily;
  if (!families) return [];
  return Object.keys(families).map((role) => ({ value: role, label: humanize(role) }));
}

function humanize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1).replace(/-/g, " ");
}

// ------------------------------------------------------------ curated sets

const style = (key: StyleKey): Slot => ({ via: "style", key });

const WIDTH: ControlSpec = {
  id: "width",
  label: "Width",
  kind: "size",
  slot: style("width"),
  tier: "pane",
  width: 132,
  choices: SIZE_CHOICES,
};

const HEIGHT: ControlSpec = {
  id: "height",
  label: "Height",
  kind: "size",
  slot: style("height"),
  tier: "pane",
  width: 132,
  choices: SIZE_CHOICES,
};

const CORNERS: ControlSpec = {
  id: "rounded",
  label: "Corners",
  kind: "choice",
  slot: style("rounded"),
  tier: "pane",
  width: 108,
  choices: CORNER_CHOICES,
};

const BORDER: readonly ControlSpec[] = [
  {
    id: "borderWidth",
    label: "Border",
    kind: "choice",
    slot: style("borderWidth"),
    tier: "bar",
    width: 100,
    choices: BORDER_CHOICES,
  },
  {
    id: "borderColor",
    label: "Border color",
    kind: "color",
    slot: style("borderColor"),
    tier: "bar",
    width: 132,
  },
];

/**
 * Headings and body text share one set: the difference between them is which
 * typeset rung they inherit, not which knobs apply.
 */
const TYPOGRAPHY: readonly ControlSpec[] = [
  { id: "font", label: "Font", kind: "font", slot: style("fontFamily"), tier: "bar", width: 112 },
  {
    id: "size",
    label: "Size",
    kind: "number",
    slot: style("fontSize"),
    tier: "bar",
    width: 84,
    min: 8,
    max: 200,
  },
  {
    id: "weight",
    label: "Weight",
    kind: "choice",
    slot: style("fontWeight"),
    tier: "bar",
    width: 112,
    choices: WEIGHT_CHOICES,
  },
  {
    id: "align",
    label: "Align",
    kind: "align",
    slot: style("textAlign"),
    tier: "bar",
    width: 96,
    choices: ALIGN_CHOICES,
  },
  { id: "color", label: "Color", kind: "color", slot: style("textColor"), tier: "bar", width: 132 },
  {
    id: "leading",
    label: "Line height",
    kind: "ratio",
    slot: style("leading"),
    tier: "pane",
    width: 96,
    min: 0.75,
    max: 3,
    step: 0.05,
  },
  {
    id: "tracking",
    label: "Letter spacing",
    kind: "choice",
    slot: style("tracking"),
    tier: "pane",
    width: 108,
    choices: TRACKING_CHOICES,
  },
  { id: "bg", label: "Background", kind: "color", slot: style("bg"), tier: "pane", width: 132 },
  { ...WIDTH },
  { ...HEIGHT },
  {
    id: "padding",
    label: "Padding",
    kind: "number",
    slot: style("padding"),
    tier: "pane",
    width: 88,
    min: 0,
    max: 256,
  },
  { ...CORNERS },
  ...BORDER.map((c) => ({ ...c, tier: "pane" as const })),
];

/**
 * A box's bar is spacing, colour and border — the things you nudge by eye. Its
 * size is on the resize handles, and the exact number is a pane away.
 */
const BOX_CONTROLS: readonly ControlSpec[] = [
  {
    id: "margin",
    label: "Margin",
    kind: "number",
    slot: style("margin"),
    tier: "bar",
    width: 88,
    min: 0,
    max: 256,
  },
  {
    id: "padding",
    label: "Padding",
    kind: "number",
    slot: style("padding"),
    tier: "bar",
    width: 88,
    min: 0,
    max: 256,
  },
  { id: "color", label: "Text", kind: "color", slot: style("textColor"), tier: "bar", width: 132 },
  { id: "bg", label: "Background", kind: "color", slot: style("bg"), tier: "bar", width: 132 },
  ...BORDER,
  { ...WIDTH },
  { ...HEIGHT },
  {
    id: "gap",
    label: "Gap",
    kind: "number",
    slot: style("gap"),
    tier: "pane",
    width: 88,
    min: 0,
    max: 256,
  },
  { ...CORNERS },
  {
    id: "align",
    label: "Align",
    kind: "align",
    slot: style("textAlign"),
    tier: "pane",
    width: 96,
    choices: ALIGN_CHOICES,
  },
];

const IMAGE_CONTROLS: readonly ControlSpec[] = [
  {
    id: "prompt",
    label: "Prompt",
    kind: "prompt",
    slot: { via: "prop", name: "src" },
    tier: "bar",
    width: 180,
  },
  { ...CORNERS, tier: "bar" },
  { ...WIDTH },
  { ...HEIGHT },
  ...BORDER.map((c) => ({ ...c, tier: "pane" as const })),
];

const ICON_CONTROLS: readonly ControlSpec[] = [
  {
    id: "name",
    label: "Icon",
    kind: "icon",
    slot: { via: "prop", name: "name" },
    tier: "bar",
    width: 148,
  },
  {
    id: "size",
    label: "Size",
    kind: "number",
    slot: { via: "prop", name: "size" },
    tier: "bar",
    width: 84,
    min: 8,
    max: 128,
  },
  { id: "color", label: "Color", kind: "color", slot: style("textColor"), tier: "bar", width: 132 },
];

/** Props we never surface: styling has its own controls, structure isn't ours. */
const SKIP_PROPS = new Set(["className", "style", "sx", "asChild", "children", "key", "ref"]);

/**
 * The long tail. Rather than curate every library component, take up to two of
 * the descriptor's own enum props — for shadcn that reliably means `variant`
 * and `size`, the two that actually matter — and follow them with the box set.
 */
function fallbackControls(
  descriptor: ComponentDescriptor | null | undefined,
): readonly ControlSpec[] {
  const fromProps: ControlSpec[] = [];
  for (const prop of descriptor?.props ?? []) {
    if (fromProps.length >= 2) break;
    if (SKIP_PROPS.has(prop.name)) continue;
    if (prop.control !== "enum" || !prop.enumValues?.length) continue;
    fromProps.push({
      id: `prop:${prop.name}`,
      label: humanize(prop.name),
      kind: "choice",
      slot: { via: "prop", name: prop.name },
      tier: "bar",
      width: 124,
      choices: prop.enumValues.map((v) => ({ value: String(v), label: humanize(String(v)) })),
    });
  }
  // The component's own props are what distinguishes it; box styling is
  // generic, so it waits in the pane rather than crowding them out.
  return [...fromProps, ...BOX_CONTROLS.map((c) => ({ ...c, tier: "pane" as const }))];
}

/**
 * Only the param list matters here, and the canvas has it from the design
 * listing without fetching the body — so take the narrower shape.
 */
export type SnippetParams = Pick<Snippet, "params">;

/** How many params the bar will carry before the rest wait in the pane. */
const SNIPPET_BAR_LIMIT = 4;

/** A snippet instance's controls are its declared params — no curation needed. */
function snippetControls(snippet: SnippetParams | null | undefined): readonly ControlSpec[] {
  if (!snippet) return [];
  const out: ControlSpec[] = [];
  for (const param of snippet.params ?? []) {
    const spec = controlForParam(param);
    if (!spec) continue;
    out.push(out.length < SNIPPET_BAR_LIMIT ? spec : { ...spec, tier: "pane" });
  }
  return out;
}

function controlForParam(param: SnippetParam): ControlSpec | null {
  const slot: Slot = { via: "arg", name: param.name };
  const base = {
    id: `arg:${param.name}`,
    label: humanize(param.name),
    slot,
    tier: "bar" as const,
  };
  switch (param.type) {
    case "number":
      return {
        ...base,
        kind: "number",
        width: 88,
        ...(param.min === undefined ? {} : { min: param.min }),
        ...(param.max === undefined ? {} : { max: param.max }),
        ...(param.step === undefined ? {} : { step: param.step }),
      };
    case "boolean":
      return { ...base, kind: "toggle", width: 88 };
    case "enum":
      return {
        ...base,
        kind: "choice",
        width: 124,
        choices: (param.enum ?? []).map((v) => ({ value: v, label: humanize(v) })),
      };
    case "color":
      return { ...base, kind: "color", width: 132 };
    case "icon":
      return { ...base, kind: "icon", width: 148 };
    case "string":
      return { ...base, kind: "text", width: 144 };
    // A `node` param is a subtree slot — there is nothing a bar control can do
    // with it, and the canvas is the right place to edit it.
    case "node":
      return null;
  }
}

export interface ResolveInput {
  readonly node: Node;
  readonly descriptor?: ComponentDescriptor | null | undefined;
  /** The definition behind a `$snippet` node. */
  readonly snippet?: SnippetParams | null | undefined;
}

export interface ResolvedControls {
  readonly role: NodeRole;
  readonly controls: readonly ControlSpec[];
}

/** The ordered controls the HUD should show for this node. */
export function resolveControls({ node, descriptor, snippet }: ResolveInput): ResolvedControls {
  const role = roleOf(node);
  switch (role) {
    case "heading":
    case "text":
      return { role, controls: TYPOGRAPHY };
    case "box":
      return { role, controls: BOX_CONTROLS };
    case "image":
      return { role, controls: IMAGE_CONTROLS };
    case "icon":
      return { role, controls: ICON_CONTROLS };
    case "snippet":
      return { role, controls: snippetControls(snippet) };
    case "other":
      return { role, controls: fallbackControls(descriptor) };
  }
}
