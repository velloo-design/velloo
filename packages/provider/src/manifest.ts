/**
 * Prop and component metadata shared by every Velloo component provider.
 * The shadcn snapshot ships one of these (generated from its TSX via
 * ts-morph at build time); future providers (MUI, no-lib, host-scan)
 * generate their own at provider-load time.
 */

export type ControlType = "boolean" | "number" | "string" | "color" | "enum" | "icon";

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
