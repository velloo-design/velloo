export interface PropDescriptor {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

export interface ComponentDescriptor {
  id: string;
  category: "ui" | "typography";
  source: "shadcn" | "velloo";
  props: PropDescriptor[];
  designModeNotes?: string;
}

export type Manifest = ComponentDescriptor[];
