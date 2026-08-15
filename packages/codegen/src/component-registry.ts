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

export type LoweredEntry = {
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
    fallbackChild?: string;
  };
};

export type ShadcnEntry = {
  kind: "shadcn";
  /** JSX component name as it appears in emitted code (e.g. "Button"). */
  jsxName: string;
  /** Import path (kebab, before the @/components/ui prefix). */
  importFile: string;
};

export type DynamicEntry = {
  kind: "dynamic";
  /** Bare-import specifier (e.g. "lucide-react"). */
  importFrom: string;
  /** Resolve the JSX component name + any default classes from node props. */
  resolve(props: Record<string, unknown>): {
    jsxName: string;
    extraClasses: string;
    fallbackName?: string;
  };
};

export type RegistryEntry = LoweredEntry | ShadcnEntry | DynamicEntry;

// Keep in sync with packages/shadcn-snapshot/src/components/velloo/heading.tsx.
const HEADING_BY_LEVEL: Record<number, string> = {
  1: "text-5xl font-bold tracking-tight leading-tight",
  2: "text-4xl font-bold tracking-tight leading-tight",
  3: "text-3xl font-semibold tracking-tight",
  4: "text-2xl font-semibold tracking-tight",
  5: "text-xl font-semibold tracking-tight",
  6: "text-lg font-semibold tracking-tight",
};

const TEXT_VARIANT_CLASSES: Record<string, string> = {
  default: "text-base text-foreground leading-7",
  muted: "text-sm text-muted-foreground",
  small: "text-sm font-medium leading-none",
  lead: "text-xl text-muted-foreground",
};

const PLACEHOLDER_ASPECT_CLASS: Record<string, string> = {
  "1/1": "aspect-square",
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "16/9": "aspect-video",
  "21/9": "aspect-[21/9]",
};

// Avatar size ladder — keep in sync with packages/shadcn-snapshot/.../placeholder.tsx.
const PLACEHOLDER_AVATAR_SIZE_CLASS: Record<string, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
  xl: "size-20 text-lg",
};

const shadcn = (jsxName: string, importFile: string): ShadcnEntry => ({
  kind: "shadcn",
  jsxName,
  importFile,
});

/** Several shadcn components live in the same source file (Card + its parts). */
export const REGISTRY: Record<string, RegistryEntry> = {
  Button: shadcn("Button", "button"),
  Badge: shadcn("Badge", "badge"),
  Card: shadcn("Card", "card"),
  CardContent: shadcn("CardContent", "card"),
  CardDescription: shadcn("CardDescription", "card"),
  CardFooter: shadcn("CardFooter", "card"),
  CardHeader: shadcn("CardHeader", "card"),
  CardTitle: shadcn("CardTitle", "card"),
  Input: shadcn("Input", "input"),
  Label: shadcn("Label", "label"),
  Separator: shadcn("Separator", "separator"),

  // Velloo-owned composition helpers with real runtime logic (gradient
  // presets, focal cropping, divider label slots). Too structural to
  // lower to a single HTML tag, so the IR keeps the identifier verbatim
  // — the agent reads it from componentsUsed and materializes the
  // component in the host app (emit_code is honest IR,
  // not paste-ready output).
  Divider: shadcn("Divider", "velloo/divider"),
  Gradient: shadcn("Gradient", "velloo/gradient"),
  Image: shadcn("Image", "velloo/image"),
  Layer: shadcn("Layer", "velloo/layer"),
  SVG: shadcn("SVG", "velloo/svg"),

  // Velloo-owned typography primitives — lower to plain HTML so the user's
  // shadcn install is enough.
  Heading: {
    kind: "lowered",
    lower(props) {
      const level = Number(props.level ?? 1);
      const safe = Number.isFinite(level) && level >= 1 && level <= 6 ? Math.trunc(level) : 1;
      const classes = HEADING_BY_LEVEL[safe] ?? HEADING_BY_LEVEL[1] ?? "";
      return { tag: `h${safe}`, extraClasses: classes };
    },
  },
  Text: {
    kind: "lowered",
    lower(props) {
      const variant = String(props.variant ?? "default");
      const classes = TEXT_VARIANT_CLASSES[variant] ?? TEXT_VARIANT_CLASSES.default ?? "";
      return { tag: "p", extraClasses: classes };
    },
  },
  Icon: {
    kind: "dynamic",
    importFrom: "lucide-react",
    resolve(props) {
      const raw = typeof props.name === "string" ? props.name : "";
      const jsxName = /^[A-Z][A-Za-z0-9]*$/.test(raw) ? raw : "HelpCircle";
      return { jsxName, extraClasses: "" };
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

/** Props that the snapshot's lowered primitives consume — strip from output. */
export const LOWERED_CONSUMED_PROPS: Record<string, Set<string>> = {
  Heading: new Set(["level"]),
  Text: new Set(["variant"]),
  Icon: new Set(["name"]),
  Placeholder: new Set(["kind", "label", "aspect", "size"]),
};
