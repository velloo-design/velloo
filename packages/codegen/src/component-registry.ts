/**
 * Maps each snapshot $ref to its codegen behavior:
 *  - "shadcn": emit a JSX component import from the user's shadcn install.
 *  - "lowered": inline the snapshot's primitive as plain HTML so users don't
 *    need any extra files in their repo.
 *  - "dynamic": emit a JSX element whose name is computed from the node's
 *    props (e.g. Icon's `name` selects which lucide component to render).
 *    The import comes from an external package (the user already depends on it
 *    or will after `pnpm add`).
 */

import {
  CONTAINER_WIDTH_CLASS,
  ICON_ALIASES,
  PLACEHOLDER_ASPECT_CLASS,
  PLACEHOLDER_AVATAR_SIZE_CLASS,
  STACK_ALIGN_CLASS,
  STACK_JUSTIFY_CLASS,
} from "@velloo/helpers";
import {
  headingClasses,
  headingInlineStyle,
  pascalizeIconName,
  resolveHeadingLevel,
  sanitizeSvgMarkup,
  textClasses,
  textInlineStyle,
} from "@velloo/schema";
import { REGISTRY_FILES } from "@velloo/shadcn-snapshot/registry-files";

type LoweredEntry = {
  kind: "lowered";
  /**
   * Decide the HTML tag and extra Tailwind classes given the node's props.
   * Optionally return extra props to splice in (e.g. role, aria-label) and a
   * fallback text child used when the node has no children of its own.
   */
  lower(props: Record<string, unknown>): {
    tag: string;
    extraClasses: string;
    extraProps?: Record<string, unknown>;
    fallbackChild?: string | undefined;
  };
};

type ShadcnEntry = {
  kind: "shadcn";
  /** JSX component name as it appears in emitted code (e.g. "Button"). */
  jsxName: string;
  /** Import path (kebab, before the @/components/ui prefix). */
  importFile: string;
};

type DynamicEntry = {
  kind: "dynamic";
  /** Bare-import specifier (e.g. "lucide-react"). */
  importFrom: string;
  /** Resolve the JSX component name + any default classes from node props. */
  resolve(props: Record<string, unknown>): {
    jsxName: string;
    extraClasses: string;
    fallbackName?: string | undefined;
  };
};

export type RegistryEntry = LoweredEntry | ShadcnEntry | DynamicEntry;

// The lowering class tables (PLACEHOLDER_*, STACK_*, CONTAINER_WIDTH_CLASS)
// live in packages/helpers/src/lowering.ts, co-located with the components they
// mirror — imported above so codegen can't drift from the runtime classes. The
// typography ladder needs no mirror at all: `headingClasses` / `textClasses`
// are the same functions the runtime components call.

const shadcn = (jsxName: string, importFile: string): ShadcnEntry => ({
  kind: "shadcn",
  jsxName,
  importFile,
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
 * back to HelpCircle. Single source for the registry resolve AND emit-code's
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

/**
 * Which file each shadcn id imports from, taken from the snapshot build's
 * extraction rather than restated here. The hand-written copy this replaces
 * had to be updated on every vendor pull, and nothing checked it: `importFile`
 * is what `shadcnInstallTargets` prints after `npx shadcn add`, so a stale
 * entry sent you to install a different component and emitted an import from
 * a file that never exported the name.
 */
function shadcnEntries(): Record<string, ShadcnEntry> {
  const out: Record<string, ShadcnEntry> = {};
  for (const [id, file] of Object.entries(REGISTRY_FILES)) out[id] = shadcn(id, file);
  return out;
}

/** Several shadcn components live in the same source file (Card + its parts). */
export const REGISTRY: Record<string, RegistryEntry> = {
  ...shadcnEntries(),

  // Velloo-owned composition helpers with real runtime logic (gradient
  // presets, focal cropping, divider label slots). Too structural to
  // lower to a single HTML tag, so the IR keeps the identifier verbatim
  // — the agent reads it from componentsUsed and materializes the
  // component in the host app (emit_code is honest IR, not paste-ready
  // output).
  Divider: shadcn("Divider", "velloo/divider"),
  Gradient: shadcn("Gradient", "velloo/gradient"),
  Image: shadcn("Image", "velloo/image"),
  Layer: shadcn("Layer", "velloo/layer"),
  SVG: shadcn("SVG", "velloo/svg"),

  // Velloo-owned layout/typography primitives — lower to plain HTML so
  // the user's shadcn install is enough.
  Box: {
    kind: "lowered",
    lower(props) {
      // `as` swaps the element (span/strong/a/…) so inline runs render inline;
      // restrict to a lowercase HTML tag name and fall back to div otherwise.
      const as = props.as;
      const tag = typeof as === "string" && /^[a-z][a-z0-9]*$/.test(as) ? as : "div";
      return { tag, extraClasses: "" };
    },
  },
  // Provider-none layout primitives — lower to plain HTML with the same
  // classes packages/provider-none/src/components.tsx applies at runtime.
  Stack: {
    kind: "lowered",
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
    lower(props) {
      const width = CONTAINER_WIDTH_CLASS[String(props.size ?? "md")] ?? CONTAINER_WIDTH_CLASS.md;
      return { tag: "div", extraClasses: `mx-auto w-full px-4 ${width}` };
    },
  },
  Heading: {
    kind: "lowered",
    lower(props) {
      return {
        tag: `h${resolveHeadingLevel(props.level)}`,
        extraClasses: headingClasses(props.level),
      };
    },
  },
  Text: {
    kind: "lowered",
    lower(props) {
      return { tag: "p", extraClasses: textClasses(props.variant) };
    },
  },
  // The `typeset` classes are velloo-owned CSS from the emitted typeset.css, not
  // Tailwind utilities, so Prose lowers to a plain element and needs nothing
  // materialized in the host app.
  Prose: {
    kind: "lowered",
    lower(props) {
      const as = props.as;
      const tag = typeof as === "string" && /^[a-z][a-z0-9]*$/.test(as) ? as : "div";
      const preset = props.preset;
      const presetClass =
        typeof preset === "string" && /^[A-Za-z0-9_-]+$/.test(preset) ? ` typeset-${preset}` : "";
      return { tag, extraClasses: `typeset${presetClass}` };
    },
  },
  Icon: {
    kind: "dynamic",
    importFrom: "lucide-react",
    resolve(props) {
      return { jsxName: resolveLucideJsxName(props.name), extraClasses: "" };
    },
  },
  Placeholder: {
    kind: "lowered",
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

/**
 * Of the component refs used, the shadcn primitives that need installing in
 * the user's app — deduped kebab source-file names ready for
 * `npx shadcn@latest add <names>`. Velloo helpers (lowered to plain HTML,
 * or the `velloo/*` composition helpers) and lucide icons need no install,
 * so they're excluded.
 */
export function shadcnInstallTargets(refs: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    const entry = REGISTRY[ref];
    if (entry?.kind === "shadcn" && !entry.importFile.startsWith("velloo/")) {
      out.add(entry.importFile);
    }
  }
  return [...out].sort();
}

/**
 * Of the component refs used, the velloo composition helpers the agent must
 * author in their app — `Gradient`, `SVG`, `Image`, `Layer`, `Divider`.
 * These carry real runtime logic (gradient presets, focal cropping, divider
 * label slots), so emit keeps the identifier rather than lowering to HTML or
 * pointing at an installable package. Box/Heading/Text/Icon are excluded —
 * they lower to plain HTML (or lucide) and need nothing.
 */
export function helpersToMaterialize(refs: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    const entry = REGISTRY[ref];
    if (entry?.kind === "shadcn" && entry.importFile.startsWith("velloo/")) {
      out.add(entry.jsxName);
    }
  }
  return [...out].sort();
}

/** Props that the snapshot's lowered primitives consume — strip from output. */
export const LOWERED_CONSUMED_PROPS: Record<string, Set<string>> = {
  Box: new Set(["as"]),
  Heading: new Set(["level"]),
  Text: new Set(["variant"]),
  Prose: new Set(["as", "preset"]),
  Icon: new Set(["name"]),
  Placeholder: new Set(["kind", "label", "aspect", "size"]),
  Stack: new Set(["direction", "gap", "align", "justify"]),
  Container: new Set(["size"]),
};

// ── Inline-style lowering for a none/none folder (the `style` channel) ───────
// Mirrors packages/provider-none/src/components-inline.tsx: the no-lib primitives
// emit as plain HTML with their structural defaults as a `style` object (themed
// via CSS vars), so `emit_code` for a no-CSS-framework folder is Tailwind-free.

type CssObject = Record<string, string | number>;
type InlineLowering = { tag: string; style: CssObject; consumed: string[]; extraProps?: CssObject };

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
 * Inline-style lowering for the no-library primitives. Returns the HTML tag +
 * the structural default `style` (which the node's authored `style` merges over)
 * + the props it consumes, or null for a `$ref` that isn't a no-lib primitive
 * (helpers like Icon/Image fall through to the normal REGISTRY). Only consulted
 * when emitting a `style`-channel (none/none) folder.
 */
export function inlineNoneLower(
  ref: string,
  props: Record<string, unknown>,
): InlineLowering | null {
  switch (ref) {
    case "Box": {
      const as = props.as;
      const tag = typeof as === "string" && /^[a-z][a-z0-9]*$/.test(as) ? as : "div";
      return { tag, style: {}, consumed: ["as"] };
    }
    case "Stack": {
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
      return { tag: "div", style, consumed: ["direction", "gap", "align", "justify"] };
    }
    case "Container":
      return {
        tag: "div",
        style: {
          marginInline: "auto",
          width: "100%",
          paddingInline: "1rem",
          maxWidth: CONTAINER_MAX_WIDTH[String(props.size ?? "md")] ?? "768px",
        },
        consumed: ["size"],
      };
    case "Card":
      return {
        tag: "div",
        style: {
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
          background: "var(--color-card)",
          color: "var(--color-card-foreground)",
          padding: "1.5rem",
          boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        },
        consumed: [],
      };
    case "Button":
      return {
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
        consumed: ["variant"],
        extraProps: { type: "button" },
      };
    case "Input":
      return {
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
        consumed: [],
        extraProps: { type: "text" },
      };
    case "Heading":
      return {
        tag: `h${resolveHeadingLevel(props.level)}`,
        style: headingInlineStyle(props.level),
        consumed: ["level"],
      };
    case "Text":
      return {
        tag: "p",
        style: textInlineStyle(props.variant),
        consumed: ["variant"],
      };
    default:
      return null;
  }
}
