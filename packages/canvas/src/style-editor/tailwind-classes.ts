/**
 * Two-way bridge between a Tailwind `className` string and the structured
 * controls in the node-editor's style pane. The class string is the source of
 * truth; `parseClasses` projects it into a {@link TwModel} of the slots the
 * controls expose, and `serializeClasses` puts a (possibly edited) model back
 * into a class string. Anything the controls don't model — responsive/state
 * variants (`md:`, `hover:`), `!important`, or utilities we don't surface — is
 * preserved verbatim in `extra` so a round-trip never drops a class.
 *
 * Values are kept in *Tailwind argument* form (`gap-4` → `"4"`, `gap-[16px]` →
 * `"[16px]"`); {@link argToPx}/{@link pxToArg} convert to/from px for the
 * numeric controls, snapping to the spacing scale and falling back to an
 * arbitrary value off-scale.
 */

/** Per-side spacing, each value a Tailwind argument (`"4"`, `"[25px]"`) or undefined. */
export interface BoxSides {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface TwModel {
  display?: string; // "flex" | "grid" | "block" | "inline-flex" | "none" …
  flexDirection?: string; // "row" | "row-reverse" | "col" | "col-reverse"
  flexWrap?: string; // "wrap" | "nowrap" | "wrap-reverse"
  justify?: string; // "start" | "center" | "end" | "between" | "around" | "evenly"
  items?: string; // "start" | "center" | "end" | "stretch" | "baseline"
  gap?: string;
  padding: BoxSides;
  margin: BoxSides;
  width?: string; // "full" | "fit" | "auto" | "screen" | "1/2" | "40" | "[12rem]"
  height?: string;
  fontFamily?: string; // "sans" | "mono" | "display" …
  fontSize?: string; // "sm" | "base" | "lg" | "[15px]"
  fontWeight?: string; // "medium" | "bold" …
  leading?: string; // "tight" | "normal" | "6" | "[1.4]"
  tracking?: string; // "tight" | "normal" | "wide" | "[-0.01em]"
  textAlign?: string; // "left" | "center" | "right" | "justify"
  textColor?: string; // "foreground" | "red-500" | "[#fff]"
  bg?: string;
  rounded?: string; // "" (base `rounded`) | "sm" | "lg" | "full" | "[6px]"
  borderColor?: string;
  borderWidth?: string; // "" (1px `border`) | "0" | "2" | "4" | "8"
}

export interface ParsedClasses {
  model: TwModel;
  /** Classes we don't model — variants, unknown utilities — kept verbatim. */
  extra: string[];
}

/** Default Tailwind spacing scale (16px root): step → px. */
const SPACING_PX: Record<string, number> = {
  "0": 0,
  px: 1,
  "0.5": 2,
  "1": 4,
  "1.5": 6,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "3.5": 14,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "8": 32,
  "9": 36,
  "10": 40,
  "11": 44,
  "12": 48,
  "14": 56,
  "16": 64,
  "20": 80,
  "24": 96,
  "28": 112,
  "32": 128,
  "36": 144,
  "40": 160,
  "44": 176,
  "48": 192,
  "56": 224,
  "64": 256,
};
const PX_TO_STEP: Record<number, string> = Object.fromEntries(
  Object.entries(SPACING_PX).map(([step, px]) => [px, step]),
);

/** A Tailwind spacing argument → px, or null if it isn't a pixel-resolvable value. */
export function argToPx(arg: string | undefined): number | null {
  if (arg === undefined) return null;
  const step = SPACING_PX[arg];
  if (step !== undefined) return step;
  const m = /^\[(-?\d*\.?\d+)px\]$/.exec(arg);
  if (m) return Number(m[1]);
  return null;
}

/** px → a Tailwind spacing argument: the scale step if exact, else `[Npx]`. */
export function pxToArg(px: number): string {
  return PX_TO_STEP[px] ?? `[${px}px]`;
}

const DISPLAY = new Set([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "grid",
  "inline-grid",
  "hidden",
  "contents",
  "table",
  "flow-root",
]);
const FONT_SIZE = new Set([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const FONT_WEIGHT = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
]);
const TEXT_ALIGN = new Set(["left", "center", "right", "justify", "start", "end"]);
const BORDER_WIDTH = new Set(["0", "2", "4", "8"]);
const BORDER_NON_COLOR = new Set([
  "x",
  "y",
  "t",
  "r",
  "b",
  "l",
  "s",
  "e",
  "solid",
  "dashed",
  "dotted",
  "double",
  "hidden",
  "none",
  "collapse",
  "separate",
  "spacing",
]);
const BG_NON_COLOR = new Set([
  "cover",
  "contain",
  "auto",
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "repeat",
  "no-repeat",
  "fixed",
  "local",
  "scroll",
  "clip",
  "origin",
  "blend",
  "gradient",
  "none",
]);

const SIDE_OF: Record<string, keyof BoxSides> = { t: "top", r: "right", b: "bottom", l: "left" };

/** Set sides on a BoxSides object given a Tailwind spacing prefix variant. */
function applySpacing(
  sides: BoxSides,
  variant: "" | "x" | "y" | "t" | "r" | "b" | "l",
  arg: string,
) {
  if (variant === "") {
    sides.top = sides.right = sides.bottom = sides.left = arg;
  } else if (variant === "x") {
    sides.left = sides.right = arg;
  } else if (variant === "y") {
    sides.top = sides.bottom = arg;
  } else {
    const side = SIDE_OF[variant];
    if (side) sides[side] = arg;
  }
}

/** Length-looking arbitrary value (`[14px]`, `[1.5rem]`, `[2ch]`) vs a color (`[#fff]`). */
function isLengthArbitrary(arg: string): boolean {
  return /^\[-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|ex|pt)\]$/.test(arg);
}

/**
 * Project a className string into the structured model. Classes carrying a
 * variant (`md:`, `hover:`) or `!important`, and any utility we don't surface,
 * land in `extra` untouched. Longhands win over shorthands (`p-4 pt-2` → top 2),
 * matching Tailwind's generated-CSS ordering, regardless of source order.
 */
export function parseClasses(input: string): ParsedClasses {
  const model: TwModel = { padding: {}, margin: {} };
  const extra: string[] = [];
  // Two passes for spacing so shorthands (p-) apply before longhands (pt-)
  // regardless of where they sit in the string.
  const spacing: Array<{
    box: "padding" | "margin";
    variant: "" | "x" | "y" | "t" | "r" | "b" | "l";
    arg: string;
  }> = [];

  for (const tok of input.split(/\s+/)) {
    const cls = tok.trim();
    if (!cls) continue;
    if (cls.includes(":") || cls.startsWith("!")) {
      extra.push(cls);
      continue;
    }

    if (DISPLAY.has(cls)) {
      model.display = cls === "hidden" ? "none" : cls;
      continue;
    }
    if (
      cls === "flex-row" ||
      cls === "flex-row-reverse" ||
      cls === "flex-col" ||
      cls === "flex-col-reverse"
    ) {
      model.flexDirection = cls.slice("flex-".length);
      continue;
    }
    if (cls === "flex-wrap" || cls === "flex-nowrap" || cls === "flex-wrap-reverse") {
      model.flexWrap = cls.slice("flex-".length);
      continue;
    }

    const dash = cls.indexOf("-");
    const prefix = dash === -1 ? cls : cls.slice(0, dash);
    const arg = dash === -1 ? "" : cls.slice(dash + 1);

    // Spacing — collect now, resolve after the loop (longhand precedence).
    if (
      (prefix === "p" ||
        prefix === "px" ||
        prefix === "py" ||
        prefix === "pt" ||
        prefix === "pr" ||
        prefix === "pb" ||
        prefix === "pl") &&
      arg
    ) {
      spacing.push({ box: "padding", variant: prefix.slice(1) as never, arg });
      continue;
    }
    if (
      (prefix === "m" ||
        prefix === "mx" ||
        prefix === "my" ||
        prefix === "mt" ||
        prefix === "mr" ||
        prefix === "mb" ||
        prefix === "ml") &&
      arg
    ) {
      spacing.push({ box: "margin", variant: prefix.slice(1) as never, arg });
      continue;
    }

    switch (prefix) {
      case "justify":
        model.justify = arg;
        continue;
      case "items":
        model.items = arg;
        continue;
      case "gap":
        if (arg) {
          model.gap = arg;
          continue;
        }
        break;
      case "w":
        if (arg) {
          model.width = arg;
          continue;
        }
        break;
      case "h":
        if (arg) {
          model.height = arg;
          continue;
        }
        break;
      case "leading":
        model.leading = arg;
        continue;
      case "tracking":
        model.tracking = arg;
        continue;
      case "font":
        if (FONT_WEIGHT.has(arg)) model.fontWeight = arg;
        else model.fontFamily = arg;
        continue;
      case "text":
        if (TEXT_ALIGN.has(arg)) model.textAlign = arg;
        else if (FONT_SIZE.has(arg) || isLengthArbitrary(arg)) model.fontSize = arg;
        else model.textColor = arg;
        continue;
      case "bg":
        if (BG_NON_COLOR.has(arg.split("-")[0] ?? "")) break;
        model.bg = arg;
        continue;
      case "rounded":
        // Per-corner (rounded-t-…, rounded-tl-…) isn't modeled — keep verbatim.
        if (arg === "" || !/^(t|r|b|l|tl|tr|br|bl|s|e|ss|se|ee|es)(-|$)/.test(arg)) {
          model.rounded = arg;
          continue;
        }
        break;
      case "border":
        if (arg === "") {
          model.borderWidth = "";
          continue;
        }
        if (BORDER_WIDTH.has(arg)) {
          model.borderWidth = arg;
          continue;
        }
        if (BORDER_NON_COLOR.has(arg.split("-")[0] ?? "")) break;
        model.borderColor = arg;
        continue;
    }

    extra.push(cls);
  }

  // Apply least-specific first (all → axis → side) so longhands win over
  // shorthands no matter their order in the source string. Stable sort keeps
  // same-specificity duplicates in source order (last wins).
  const rank = (v: string) => (v === "" ? 0 : v === "x" || v === "y" ? 1 : 2);
  spacing.sort((a, b) => rank(a.variant) - rank(b.variant));
  for (const s of spacing) applySpacing(model[s.box], s.variant, s.arg);

  return { model, extra };
}

/** Collapse a BoxSides into the fewest Tailwind classes (`p-4`, `py-2 px-1`, `pt-3`…). */
function serializeSpacing(prefix: "p" | "m", sides: BoxSides): string[] {
  const { top, right, bottom, left } = sides;
  if (top === undefined && right === undefined && bottom === undefined && left === undefined)
    return [];
  if (top !== undefined && top === right && right === bottom && bottom === left)
    return [`${prefix}-${top}`];
  const out: string[] = [];
  if (top !== undefined && top === bottom) {
    out.push(`${prefix}y-${top}`);
  } else {
    if (top !== undefined) out.push(`${prefix}t-${top}`);
    if (bottom !== undefined) out.push(`${prefix}b-${bottom}`);
  }
  if (left !== undefined && left === right) {
    out.push(`${prefix}x-${left}`);
  } else {
    if (left !== undefined) out.push(`${prefix}l-${left}`);
    if (right !== undefined) out.push(`${prefix}r-${right}`);
  }
  return out;
}

/** Reassemble a className string from the model, then the preserved `extra`. */
export function serializeClasses({ model, extra }: ParsedClasses): string {
  const out: string[] = [];
  if (model.display) out.push(model.display === "none" ? "hidden" : model.display);
  if (model.flexDirection) out.push(`flex-${model.flexDirection}`);
  if (model.flexWrap) out.push(`flex-${model.flexWrap}`);
  if (model.items) out.push(`items-${model.items}`);
  if (model.justify) out.push(`justify-${model.justify}`);
  if (model.gap) out.push(`gap-${model.gap}`);
  out.push(...serializeSpacing("p", model.padding));
  out.push(...serializeSpacing("m", model.margin));
  if (model.width) out.push(`w-${model.width}`);
  if (model.height) out.push(`h-${model.height}`);
  if (model.fontFamily) out.push(`font-${model.fontFamily}`);
  if (model.fontSize) out.push(`text-${model.fontSize}`);
  if (model.fontWeight) out.push(`font-${model.fontWeight}`);
  if (model.leading) out.push(`leading-${model.leading}`);
  if (model.tracking) out.push(`tracking-${model.tracking}`);
  if (model.textAlign) out.push(`text-${model.textAlign}`);
  if (model.textColor) out.push(`text-${model.textColor}`);
  if (model.bg) out.push(`bg-${model.bg}`);
  if (model.rounded !== undefined)
    out.push(model.rounded === "" ? "rounded" : `rounded-${model.rounded}`);
  if (model.borderWidth !== undefined)
    out.push(model.borderWidth === "" ? "border" : `border-${model.borderWidth}`);
  if (model.borderColor) out.push(`border-${model.borderColor}`);
  out.push(...extra);
  return out.join(" ");
}

/** Toggle a class in `extra` (used by the raw chip list). */
