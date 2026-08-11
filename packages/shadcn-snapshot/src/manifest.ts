export type ControlType = "boolean" | "number" | "string" | "color" | "enum";

export interface PropDescriptor {
  name: string;
  /** Raw TS type string from ts-morph (e.g. "boolean | undefined"). */
  type: string;
  optional: boolean;
  defaultValue?: string;
  /** Inferred control type for the inspector. */
  control: ControlType;
  /** Allowed values when `control === "enum"`. */
  enumValues?: (string | number)[];
}

export interface ComponentDescriptor {
  id: string;
  category: "ui" | "typography";
  source: "shadcn" | "velloo";
  props: PropDescriptor[];
  designModeNotes?: string;
}

export type Manifest = ComponentDescriptor[];
