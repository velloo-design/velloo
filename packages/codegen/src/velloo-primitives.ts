/**
 * The velloo primitives — the component set every framework shares, and the
 * last link in emit's resolution chain.
 *
 * These are velloo's own components, not any library's: the layout and
 * typography primitives that lower to plain HTML (`Box`, `Stack`, `Heading`, …),
 * the composition helpers with real runtime logic the agent authors in their app
 * (`Gradient`, `SVG`, `Image`, `Layer`, `Divider`), and `Icon`, whose JSX name
 * comes from lucide. A framework target is consulted first, so a MUI screen's
 * `Box` is MUI's; what reaches here is what no framework claimed.
 *
 * Two channels, because a folder may have no CSS framework: the Tailwind
 * channel lowers to classes mirroring the runtime components' own, and the
 * `style` channel lowers to an inline `style` object instead (the no-lib
 * primitives only — helpers fall through to the class lowering either way).
 */

import {
  BUTTON_BASE_CLASS,
  BUTTON_VARIANT_CLASS,
  CARD_CLASS,
  CONTAINER_WIDTH_CLASS,
  ELEMENT_TAG,
  ICON_ALIASES,
  INPUT_CLASS,
  PLACEHOLDER_ASPECT_CLASS,
  PLACEHOLDER_AVATAR_SIZE_CLASS,
  STACK_ALIGN_CLASS,
  STACK_JUSTIFY_CLASS,
} from "@velloo/helpers";
import { ownEntry } from "@velloo/provider";
import {
  headingClasses,
  headingInlineStyle,
  pascalizeIconName,
  resolveHeadingLevel,
  sanitizeSvgMarkup,
  textClasses,
  textInlineStyle,
} from "@velloo/schema";
import type { CodegenTarget, Emit } from "./emit-code/target.ts";

// The no-library primitives' class tables (STACK_*, CONTAINER_WIDTH_CLASS,
// CARD/BUTTON/INPUT) are the very constants their components apply, and the
// typography ladder (`headingClasses` / `textClasses`) the very functions —
// so codegen can't drift from the runtime classes. Only PLACEHOLDER_* is a
// mirror (packages/helpers/src/lowering.ts).

/** A composition helper the agent authors in their app. */
const authored = (jsxName: string): Emit => ({
  kind: "component",
  jsxName,
  provision: { kind: "author" },
});

/**
 * Brand glyphs lucide removed (they live in `lucide-static`/`simple-icons`
 * now). These are exactly the names people reach for, so a generic "closest
 * match" suggestion (GitGraph for Github) misleads — point at the real fix.
 * Shared with the server's mutation-time advisory so the two messages can't
 * drift; PascalCase, matching `pascalizeIconName` output.
 */
export const REMOVED_BRAND_ICONS: ReadonlySet<string> = new Set([
  "Apple",
  "Chrome",
  "Codepen",
  "Discord",
  "Dribbble",
  "Facebook",
  "Figma",
  "Framer",
  "Github",
  "Gitlab",
  "Google",
  "Instagram",
  "Linkedin",
  "Slack",
  "Trello",
  "Twitch",
  "Twitter",
  "Youtube",
]);

/**
 * Does `name` resolve to a real lucide export? Checked against the same
 * icon data the runtime Icon renders from, so codegen and canvas agree on
 * what exists. `ICON_ALIASES` is keyed by every accepted spelling
 * (PascalCase, the `*Icon` suffix form, and lucide's own renames), and its
 * keys cover all `ICON_NODES` — so pascalizing first also admits the
 * kebab/snake/space-separated forms.
 */
export function isKnownLucideIcon(name: unknown): boolean {
  const raw = typeof name === "string" ? name : "";
  return ICON_ALIASES[pascalizeIconName(raw)] !== undefined;
}

/**
 * Icon's `name` prop → lucide JSX identifier. PascalCase passes through,
 * kebab/snake/space-separated names normalize ("arrow-right" →
 * "ArrowRight"), and anything that doesn't name a real lucide export falls
 * back to HelpCircle. Single source for the Icon lowering AND emit-code's
 * iconsUsed metadata so the two can't drift.
 *
 * The identifier-shape test alone used to pass a well-formed name that
 * lucide doesn't export — brand glyphs above all, dropped in lucide 1.0 —
 * emitting `import { Github } from "lucide-react"`, which only fails once
 * it reaches the user's build. The canvas already renders those as
 * HelpCircle; matching that here keeps emitted code compiling, and callers
 * surface `unresolvedIconNames` as an emit warning so the substitution is
 * never silent.
 */
export function resolveLucideJsxName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const pascal = pascalizeIconName(raw);
  return isKnownLucideIcon(pascal) ? pascal : "HelpCircle";
}

/**
 * The SVG helper inlines its `content` string via dangerouslySetInnerHTML in
 * the shipped app, so a static `content` from (untrusted) design JSON must have
 * its active content stripped before emit_code writes it into the consumer app
 * — the same sanitization the runtime SVG component applies. Dynamic
 * ($param/$if) content is a caller-filled slot, sanitized at the render
 * boundary instead. Mutates `props` in place; no-op for non-SVG refs.
 */
export function sanitizeEmittedProps(ref: string, props: Record<string, unknown>): void {
  if (ref === "SVG" && typeof props.content === "string") {
    props.content = sanitizeSvgMarkup(props.content);
  }
}

/** `as` takes an element name only — anything else renders a div. */
function asTag(as: unknown): string {
  return typeof as === "string" && ELEMENT_TAG.test(as) ? as : "div";
}

/**
 * The Tailwind-channel lowerings. Every velloo primitive lands here: the
 * composition helpers keep their identifier, the rest become plain HTML with
 * the classes their runtime component applies.
 */
const CLASS_CHANNEL: Record<string, Emit> = {
  // Composition helpers with real runtime logic (gradient presets, focal
  // cropping, divider label slots). Too structural to lower to a single HTML
  // tag, so the IR keeps the identifier verbatim — the agent reads it from
  // helpersToMaterialize and writes the component in the host app (emit_code is
  // honest IR, not paste-ready output).
  Divider: authored("Divider"),
  Gradient: authored("Gradient"),
  Image: authored("Image"),
  Layer: authored("Layer"),
  SVG: authored("SVG"),

  Box: {
    kind: "lowered",
    consumed: ["as"],
    lower(props) {
      // `as` swaps the element (span/strong/a/…) so inline runs render inline.
      return { tag: asTag(props.as), extraClasses: "" };
    },
  },
  Stack: {
    kind: "lowered",
    consumed: ["direction", "gap", "align", "justify"],
    lower(props) {
      const direction = props.direction === "row" ? "flex-row" : "flex-col";
      const gap = typeof props.gap === "number" ? props.gap : 4;
      const align = STACK_ALIGN_CLASS[String(props.align)] ?? "";
      const justify = STACK_JUSTIFY_CLASS[String(props.justify)] ?? "";
      const classes = ["flex", direction, `gap-${gap}`, align, justify].filter(Boolean).join(" ");
      return { tag: "div", extraClasses: classes };
    },
  },
  Container: {
    kind: "lowered",
    consumed: ["size"],
    lower(props) {
      const width = CONTAINER_WIDTH_CLASS[String(props.size ?? "md")] ?? CONTAINER_WIDTH_CLASS.md;
      return { tag: "div", extraClasses: `mx-auto w-full px-4 ${width}` };
    },
  },
  Card: {
    kind: "lowered",
    lower() {
      return { tag: "div", extraClasses: CARD_CLASS };
    },
  },
  Button: {
    kind: "lowered",
    consumed: ["variant"],
    lower(props) {
      const variant =
        BUTTON_VARIANT_CLASS[String(props.variant ?? "default")] ?? BUTTON_VARIANT_CLASS.default;
      return {
        tag: "button",
        extraClasses: `${BUTTON_BASE_CLASS} ${variant}`,
        extraProps: { type: "button" },
      };
    },
  },
  Input: {
    kind: "lowered",
    lower() {
      return { tag: "input", extraClasses: INPUT_CLASS, extraProps: { type: "text" } };
    },
  },
  Heading: {
    kind: "lowered",
    consumed: ["level"],
    lower(props) {
      return {
        tag: `h${resolveHeadingLevel(props.level)}`,
        extraClasses: headingClasses(props.level),
      };
    },
  },
  Text: {
    kind: "lowered",
    consumed: ["variant"],
    lower(props) {
      return { tag: "p", extraClasses: textClasses(props.variant) };
    },
  },
  // The `typeset` classes are velloo-owned CSS from the emitted typeset.css, not
  // Tailwind utilities, so Prose lowers to a plain element and needs nothing
  // materialized in the host app.
  Prose: {
    kind: "lowered",
    consumed: ["as", "preset"],
    lower(props) {
      const preset = props.preset;
      const presetClass =
        typeof preset === "string" && /^[A-Za-z0-9_-]+$/.test(preset) ? ` typeset-${preset}` : "";
      return { tag: asTag(props.as), extraClasses: `typeset${presetClass}` };
    },
  },
  Icon: {
    kind: "dynamic",
    consumed: ["name"],
    resolve(props) {
      return { jsxName: resolveLucideJsxName(props.name), extraClasses: "" };
    },
  },
  Placeholder: {
    kind: "lowered",
    consumed: ["kind", "label", "aspect", "size"],
    lower(props) {
      const kind = String(props.kind ?? "image");
      const label = typeof props.label === "string" ? (props.label as string) : undefined;
      if (kind === "avatar") {
        const size = String(props.size ?? "md");
        const sizeClass = PLACEHOLDER_AVATAR_SIZE_CLASS[size] ?? PLACEHOLDER_AVATAR_SIZE_CLASS.md;
        return {
          tag: "div",
          extraClasses: `inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium ${sizeClass}`,
          extraProps: {
            role: "img",
            "aria-label": label ? `placeholder: ${label}` : "placeholder avatar",
          },
          fallbackChild: label ? label.slice(0, 2).toUpperCase() : "",
        };
      }
      const aspect = String(props.aspect ?? "16/9");
      const aspectClass = PLACEHOLDER_ASPECT_CLASS[aspect] ?? PLACEHOLDER_ASPECT_CLASS["16/9"];
      return {
        tag: "div",
        extraClasses: `flex w-full items-center justify-center bg-muted text-muted-foreground text-xs uppercase tracking-wider rounded-md border border-dashed border-border ${aspectClass}`,
        extraProps: {
          role: "img",
          "aria-label": label ? `placeholder: ${label}` : "placeholder image",
        },
        fallbackChild: label ?? "image",
      };
    },
  },
};

// ── Inline-style lowering for a folder with no CSS framework ─────────────────
// Mirrors packages/provider-none/src/components-inline.tsx: the no-lib
// primitives emit as plain HTML with their structural defaults as a `style`
// object (themed via CSS vars), so `emit_code` on the `style` channel is
// Tailwind-free. Only these ids differ by channel — a helper not listed here
// falls through to CLASS_CHANNEL.

type CssObject = Record<string, string | number>;

const space = (n: number) => `${n * 0.25}rem`;
const STACK_ALIGN_STYLE: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
};
const STACK_JUSTIFY_STYLE: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
};
const CONTAINER_MAX_WIDTH: Record<string, string> = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  full: "100%",
};
const BUTTON_VARIANT_STYLE: Record<string, CssObject> = {
  default: { background: "var(--color-foreground)", color: "var(--color-background)" },
  ghost: { background: "transparent", color: "var(--color-foreground)" },
  outline: {
    background: "transparent",
    color: "var(--color-foreground)",
    border: "1px solid var(--color-border)",
  },
};
// Heading/Text have no table here: `headingInlineStyle` / `textInlineStyle` are
// the same functions components-inline.tsx renders with.

/**
 * The `style`-channel lowerings, by id. Keyed the same way as CLASS_CHANNEL and
 * consulted first on that channel, so `Card` becomes a styled `<div>` rather
 * than falling through to its Tailwind form.
 */
const STYLE_CHANNEL: Record<string, Emit> = {
  Box: {
    kind: "inline",
    consumed: ["as"],
    lower: (props) => ({ tag: asTag(props.as), style: {} }),
  },
  Stack: {
    kind: "inline",
    consumed: ["direction", "gap", "align", "justify"],
    lower(props) {
      const gap = typeof props.gap === "number" ? props.gap : 4;
      const style: CssObject = {
        display: "flex",
        flexDirection: props.direction === "row" ? "row" : "column",
        gap: space(gap),
      };
      const align = STACK_ALIGN_STYLE[String(props.align)];
      if (align) style.alignItems = align;
      const justify = STACK_JUSTIFY_STYLE[String(props.justify)];
      if (justify) style.justifyContent = justify;
      return { tag: "div", style };
    },
  },
  Container: {
    kind: "inline",
    consumed: ["size"],
    lower: (props) => ({
      tag: "div",
      style: {
        marginInline: "auto",
        width: "100%",
        paddingInline: "1rem",
        maxWidth: CONTAINER_MAX_WIDTH[String(props.size ?? "md")] ?? "768px",
      },
    }),
  },
  Card: {
    kind: "inline",
    lower: () => ({
      tag: "div",
      style: {
        borderRadius: "var(--radius)",
        border: "1px solid var(--color-border)",
        background: "var(--color-card)",
        color: "var(--color-card-foreground)",
        padding: "1.5rem",
        boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      },
    }),
  },
  Button: {
    kind: "inline",
    consumed: ["variant"],
    lower: (props) => ({
      tag: "button",
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        borderRadius: "var(--radius)",
        padding: "0.5rem 1rem",
        fontSize: "0.875rem",
        fontWeight: 500,
        cursor: "pointer",
        ...(BUTTON_VARIANT_STYLE[String(props.variant ?? "default")] ??
          BUTTON_VARIANT_STYLE.default),
      },
      extraProps: { type: "button" },
    }),
  },
  Input: {
    kind: "inline",
    lower: () => ({
      tag: "input",
      style: {
        display: "block",
        width: "100%",
        borderRadius: "var(--radius)",
        border: "1px solid var(--color-input)",
        background: "var(--color-background)",
        padding: "0.5rem 0.75rem",
        fontSize: "0.875rem",
      },
      extraProps: { type: "text" },
    }),
  },
  Heading: {
    kind: "inline",
    consumed: ["level"],
    lower: (props) => ({
      tag: `h${resolveHeadingLevel(props.level)}`,
      style: headingInlineStyle(props.level),
    }),
  },
  Text: {
    kind: "inline",
    consumed: ["variant"],
    lower: (props) => ({ tag: "p", style: textInlineStyle(props.variant) }),
  },
};

/**
 * The velloo primitives as a codegen target, for the screen's style channel.
 * Last in emit's resolution chain, so a framework that owns one of these names
 * wins — what lands here is velloo's own.
 */
function channelTarget(channels: Record<string, Emit>[]): CodegenTarget {
  return {
    componentFor(id) {
      for (const channel of channels) {
        // `ownEntry`, not a bare index: design JSON names the `$ref`, so
        // `constructor` or `toString` must not resolve off the prototype.
        const emit = ownEntry(channel, id);
        if (emit) return emit;
      }
      return null;
    },
  };
}

// Built once: `emitTree` resolves every node through one of these.
const CLASS_TARGET = channelTarget([CLASS_CHANNEL]);
const STYLE_TARGET = channelTarget([STYLE_CHANNEL, CLASS_CHANNEL]);

export function vellooPrimitiveTarget(inlineStyle: boolean): CodegenTarget {
  return inlineStyle ? STYLE_TARGET : CLASS_TARGET;
}
