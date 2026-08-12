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
  /** Decide the HTML tag and extra Tailwind classes given the node's props. */
  lower(props: Record<string, unknown>): { tag: string; extraClasses: string };
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

const HEADING_BY_LEVEL: Record<number, string> = {
  1: "text-4xl font-semibold tracking-tight",
  2: "text-3xl font-semibold tracking-tight",
  3: "text-2xl font-semibold tracking-tight",
  4: "text-xl font-semibold tracking-tight",
  5: "text-lg font-semibold tracking-tight",
  6: "text-base font-semibold tracking-tight",
};

const TEXT_VARIANT_CLASSES: Record<string, string> = {
  default: "text-base text-foreground leading-7",
  muted: "text-sm text-muted-foreground",
  small: "text-sm font-medium leading-none",
  lead: "text-xl text-muted-foreground",
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
};

/** Props that the snapshot's lowered primitives consume — strip from output. */
export const LOWERED_CONSUMED_PROPS: Record<string, Set<string>> = {
  Heading: new Set(["level"]),
  Text: new Set(["variant"]),
  Icon: new Set(["name"]),
};
