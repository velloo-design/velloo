/**
 * Prop and component metadata shared by every Velloo component provider.
 * The shadcn snapshot ships one of these (generated from its TSX via
 * ts-morph at build time); future providers (MUI, no-lib, host-scan)
 * generate their own at provider-load time.
 */

export type ControlType = "boolean" | "number" | "string" | "color" | "enum" | "icon";

/**
 * The shelf a component sits on, for browsing a library too large to read
 * linearly. Deliberately coarse and framework-neutral: the same nine shelves
 * have to hold shadcn's ~55 families, MUI's, and six bare primitives, so they
 * name *what a component is for* rather than any library's own file layout.
 *
 * Distinct from `category`, which is the two-value ui/typography split the
 * inspector and the on-disk extension schema already speak.
 */
export const COMPONENT_GROUPS = [
  { id: "actions", label: "Actions" },
  { id: "forms", label: "Forms & Inputs" },
  { id: "display", label: "Display" },
  { id: "feedback", label: "Feedback" },
  { id: "navigation", label: "Navigation" },
  { id: "overlays", label: "Overlays" },
  { id: "layout", label: "Layout" },
  { id: "typography", label: "Typography" },
  { id: "visuals", label: "Visuals" },
  { id: "chat", label: "Chat & AI" },
] as const;

export type ComponentGroup = (typeof COMPONENT_GROUPS)[number]["id"];

/** Where a descriptor with no `group` lands, so no component is unreachable. */
export const UNGROUPED_LABEL = "Components";

export function groupLabel(group: ComponentGroup | undefined): string {
  return COMPONENT_GROUPS.find((g) => g.id === group)?.label ?? UNGROUPED_LABEL;
}

export interface PropDescriptor {
  name: string;
  /** Raw TS type string from ts-morph (e.g. "boolean | undefined"). */
  type: string;
  optional: boolean;
  defaultValue?: string | undefined;
  /** Inferred control type for the inspector. */
  control: ControlType;
  /** Allowed values when `control === "enum"`. */
  enumValues?: (string | number)[] | undefined;
}

export interface ComponentDescriptor {
  id: string;
  category: "ui" | "typography";
  /**
   * Provenance tag — "shadcn" for vendored upstream primitives, "velloo" for
   * Velloo's own helpers (Heading, Text, Icon, Placeholder, SVG, Image,
   * Layer, Gradient, Divider). Other providers may use their own tags
   * (e.g. "mui", "host") at runtime; the type stays a free-form string
   * so providers can add their own values without churning this schema.
   */
  source: "shadcn" | "velloo" | (string & {});
  /** Browsing shelf; absent means the catch-all bucket. */
  group?: ComponentGroup | undefined;
  /**
   * The compound root this component belongs to — `"Field"` for `FieldLabel`,
   * and for `Field` itself. Most of a modern library is sub-pieces (211 of the
   * snapshot's 292 entries take only `className`/`children`), which are
   * meaningless alone and misleading as peers of their root: what an agent
   * needs is that `Field` is *composed of* `FieldLabel` + `FieldDescription` +
   * `FieldError`. Grouping by this turns a flat 292-name list into ~55
   * families that state their own shape.
   */
  family?: string | undefined;
  /**
   * The library's own name for the unit this component ships in — for shadcn,
   * the registry item and so the filename (`ButtonGroupSeparator` →
   * `button-group`). Set by whatever generated the manifest, which is the only
   * thing that knows it; inferring it from the id means guessing where a
   * component lives, and a wrong guess resolves to some *other* component's
   * file rather than failing. Absent for libraries that install as one package.
   */
  registryName?: string | undefined;
  props: PropDescriptor[];
  designModeNotes?: string | undefined;
  /**
   * Canonical props for one working instance — the fastest way for an
   * agent to use an unfamiliar component correctly (prop names tell
   * you *what* exists; the example shows *shapes*, e.g. Chart's
   * `data: [{ x, y }]`).
   */
  example?: Record<string, unknown> | undefined;
}

export type Manifest = ComponentDescriptor[];
