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

import { pascalizeIconName } from "@velloo/schema";

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

// Keep in sync with packages/provider-none/src/components.tsx.
const STACK_ALIGN_CLASS: Record<string, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};
const STACK_JUSTIFY_CLASS: Record<string, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
};
const CONTAINER_WIDTH_CLASS: Record<string, string> = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  full: "max-w-full",
};

const shadcn = (jsxName: string, importFile: string): ShadcnEntry => ({
  kind: "shadcn",
  jsxName,
  importFile,
});

/**
 * Icon's `name` prop → lucide JSX identifier. PascalCase passes through,
 * kebab/snake/space-separated names normalize ("arrow-right" →
 * "ArrowRight"), anything that still isn't a valid identifier falls back
 * to HelpCircle. Single source for the registry resolve AND emit-code's
 * iconsUsed metadata so the two can't drift.
 */
export function resolveLucideJsxName(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const pascal = pascalizeIconName(raw);
  return /^[A-Z][A-Za-z0-9]*$/.test(pascal) ? pascal : "HelpCircle";
}

/**
 * shadcn source file → exported component ids. Keep in sync with
 * packages/shadcn-snapshot/src/registry.ts — the contract test in
 * __tests__/registry-contract.test.ts asserts every snapshot component
 * resolves here, so palette growth can't silently break emit_code again.
 */
const SHADCN_FILE_EXPORTS: Record<string, string[]> = {
  accordion: ["Accordion", "AccordionContent", "AccordionItem", "AccordionTrigger"],
  alert: ["Alert", "AlertDescription", "AlertTitle"],
  "alert-dialog": [
    "AlertDialog",
    "AlertDialogAction",
    "AlertDialogCancel",
    "AlertDialogContent",
    "AlertDialogDescription",
    "AlertDialogFooter",
    "AlertDialogHeader",
    "AlertDialogTitle",
    "AlertDialogTrigger",
  ],
  avatar: ["Avatar", "AvatarFallback", "AvatarImage"],
  badge: ["Badge"],
  breadcrumb: [
    "Breadcrumb",
    "BreadcrumbEllipsis",
    "BreadcrumbItem",
    "BreadcrumbLink",
    "BreadcrumbList",
    "BreadcrumbPage",
    "BreadcrumbSeparator",
  ],
  button: ["Button"],
  calendar: ["Calendar"],
  card: [
    "Card",
    "CardAction",
    "CardContent",
    "CardDescription",
    "CardFooter",
    "CardHeader",
    "CardTitle",
  ],
  carousel: ["Carousel", "CarouselContent", "CarouselItem", "CarouselNext", "CarouselPrevious"],
  chart: [
    "Chart",
    "ChartContainer",
    "ChartLegend",
    "ChartLegendContent",
    "ChartTooltip",
    "ChartTooltipContent",
  ],
  checkbox: ["Checkbox"],
  collapsible: ["Collapsible", "CollapsibleContent", "CollapsibleTrigger"],
  dialog: [
    "Dialog",
    "DialogClose",
    "DialogContent",
    "DialogDescription",
    "DialogFooter",
    "DialogHeader",
    "DialogTitle",
    "DialogTrigger",
  ],
  "dropdown-menu": [
    "DropdownMenu",
    "DropdownMenuCheckboxItem",
    "DropdownMenuContent",
    "DropdownMenuGroup",
    "DropdownMenuItem",
    "DropdownMenuLabel",
    "DropdownMenuRadioGroup",
    "DropdownMenuRadioItem",
    "DropdownMenuSeparator",
    "DropdownMenuShortcut",
    "DropdownMenuSub",
    "DropdownMenuSubContent",
    "DropdownMenuSubTrigger",
    "DropdownMenuTrigger",
  ],
  input: ["Input"],
  label: ["Label"],
  pagination: [
    "Pagination",
    "PaginationContent",
    "PaginationEllipsis",
    "PaginationItem",
    "PaginationLink",
    "PaginationNext",
    "PaginationPrevious",
  ],
  popover: ["Popover", "PopoverAnchor", "PopoverContent", "PopoverTrigger"],
  progress: ["Progress"],
  "radio-group": ["RadioGroup", "RadioGroupItem"],
  "scroll-area": ["ScrollArea", "ScrollBar"],
  select: [
    "Select",
    "SelectContent",
    "SelectGroup",
    "SelectItem",
    "SelectLabel",
    "SelectSeparator",
    "SelectTrigger",
    "SelectValue",
  ],
  separator: ["Separator"],
  sheet: [
    "Sheet",
    "SheetClose",
    "SheetContent",
    "SheetDescription",
    "SheetFooter",
    "SheetHeader",
    "SheetTitle",
    "SheetTrigger",
  ],
  skeleton: ["Skeleton"],
  slider: ["Slider"],
  sonner: ["Toaster"],
  switch: ["Switch"],
  table: [
    "Table",
    "TableBody",
    "TableCaption",
    "TableCell",
    "TableFooter",
    "TableHead",
    "TableHeader",
    "TableRow",
  ],
  tabs: ["Tabs", "TabsContent", "TabsList", "TabsTrigger"],
  textarea: ["Textarea"],
  toggle: ["Toggle"],
  "toggle-group": ["ToggleGroup", "ToggleGroupItem"],
  tooltip: ["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"],
};

function shadcnEntries(): Record<string, ShadcnEntry> {
  const out: Record<string, ShadcnEntry> = {};
  for (const [file, ids] of Object.entries(SHADCN_FILE_EXPORTS)) {
    for (const id of ids) out[id] = shadcn(id, file);
  }
  return out;
}

/** Several shadcn components live in the same source file (Card + its parts). */
export const REGISTRY: Record<string, RegistryEntry> = {
  ...shadcnEntries(),

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

  // Velloo-owned layout/typography primitives — lower to plain HTML so
  // the user's shadcn install is enough.
  Box: {
    kind: "lowered",
    lower() {
      return { tag: "div", extraClasses: "" };
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
  Heading: new Set(["level"]),
  Text: new Set(["variant"]),
  Icon: new Set(["name"]),
  Placeholder: new Set(["kind", "label", "aspect", "size"]),
  Stack: new Set(["direction", "gap", "align", "justify"]),
  Container: new Set(["size"]),
};
