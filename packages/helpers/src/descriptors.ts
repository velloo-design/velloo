import type { ComponentDescriptor } from "@velloo/provider";

/**
 * The canonical manifest entries for the velloo helpers (`source: "velloo"`).
 * Single source: the shadcn snapshot's `build.ts` splices these into its
 * generated `dist/manifest.json` (augmenting `Icon.name` with the live
 * lucide-react name list at build time), and `provider-none` composes its
 * hand-authored manifest from them. Keep each entry mirroring the co-located
 * component's props (`./heading.tsx`, `./icon.tsx`, …).
 */
export const HELPER_DESCRIPTORS: readonly ComponentDescriptor[] = [
  {
    id: "Box",
    category: "ui",
    source: "velloo",
    props: [],
    example: { className: "flex flex-col gap-6 px-8 py-12" },
  },
  {
    id: "Divider",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "variant",
        type: '"solid" | "dotted" | "dashed" | "gradient" | "pinched" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["solid", "dotted", "dashed", "gradient", "pinched"],
      },
      {
        name: "orientation",
        type: '"horizontal" | "vertical" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["horizontal", "vertical"],
      },
      { name: "label", type: "string | undefined", optional: true, control: "string" },
      {
        name: "color",
        type: '"primary" | "accent" | "muted" | "border" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["primary", "accent", "muted", "border"],
      },
    ],
    example: { variant: "gradient", color: "primary", label: "OR" },
  },
  {
    id: "Gradient",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "preset",
        type: '"primary" | "accent" | "radial" | "mesh" | "dusk" | "dawn" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["primary", "accent", "radial", "mesh", "dusk", "dawn"],
      },
      {
        name: "direction",
        type: '"t" | "b" | "l" | "r" | "tl" | "tr" | "bl" | "br" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["t", "b", "l", "r", "tl", "tr", "bl", "br"],
      },
    ],
    example: {
      preset: "dusk",
      direction: "br",
      className: "absolute inset-0 -z-0 pointer-events-none",
    },
  },
  {
    id: "Heading",
    category: "typography",
    source: "velloo",
    props: [
      {
        name: "level",
        type: "1 | 2 | 3 | 4 | 5 | 6 | undefined",
        optional: true,
        control: "enum",
        enumValues: [1, 2, 3, 4, 5, 6],
      },
    ],
    example: { level: 2, children: "Section title", className: "text-3xl font-semibold" },
  },
  {
    id: "Icon",
    category: "ui",
    source: "velloo",
    props: [
      // `enumValues` (the lucide icon name list) is injected at snapshot build
      // time from the installed lucide-react, so it never drifts from what the
      // Icon component can actually resolve.
      { name: "name", type: "string", optional: false, control: "icon", defaultValue: "Heart" },
      { name: "size", type: "number | undefined", optional: true, control: "number" },
      { name: "strokeWidth", type: "number | undefined", optional: true, control: "number" },
    ],
    designModeNotes:
      "`name` accepts any lucide-react icon, PascalCase (ArrowRight) or kebab-case (arrow-right); full list at lucide.dev (the enumValues here are sampled). " +
      "`size` sets width/height in px, but a Tailwind sizing class in `className` (e.g. `size-4`) wins via CSS — pass one or the other, not both expecting `size` to apply.",
    example: { name: "Sparkles", className: "size-4 text-primary" },
  },
  {
    id: "Image",
    category: "ui",
    source: "velloo",
    props: [
      { name: "src", type: "string", optional: false, control: "string" },
      {
        name: "aspect",
        type: '"1/1" | "4/3" | "3/4" | "16/9" | "21/9" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["1/1", "4/3", "3/4", "16/9", "21/9"],
      },
      {
        name: "focal",
        type: "{ x: number; y: number; } | undefined",
        optional: true,
        control: "string",
      },
      {
        name: "treatment",
        type: '"overlay-dark" | "overlay-light" | "blend-multiply" | "grayscale" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["overlay-dark", "overlay-light", "blend-multiply", "grayscale"],
      },
      { name: "fill", type: "boolean | undefined", optional: true, control: "boolean" },
    ],
    example: {
      src: "/assets/hero.png",
      aspect: "16/9",
      focal: { x: 0.5, y: 0.35 },
      treatment: "overlay-dark",
      className: "rounded-xl",
    },
  },
  {
    id: "Layer",
    category: "ui",
    source: "velloo",
    props: [
      { name: "top", type: "string | number | undefined", optional: true, control: "string" },
      { name: "right", type: "string | number | undefined", optional: true, control: "string" },
      { name: "bottom", type: "string | number | undefined", optional: true, control: "string" },
      { name: "left", type: "string | number | undefined", optional: true, control: "string" },
      { name: "z", type: "number | undefined", optional: true, control: "number" },
      { name: "pointerEvents", type: "boolean | undefined", optional: true, control: "boolean" },
    ],
    example: { top: 16, left: 16, z: 2 },
  },
  {
    id: "Placeholder",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "kind",
        type: '"image" | "avatar" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["image", "avatar"],
      },
      { name: "label", type: "string | undefined", optional: true, control: "string" },
      {
        name: "aspect",
        type: '"1/1" | "4/3" | "3/4" | "16/9" | "21/9" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["1/1", "4/3", "3/4", "16/9", "21/9"],
      },
      {
        name: "size",
        type: '"sm" | "lg" | "md" | "xl" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["sm", "lg", "md", "xl"],
      },
    ],
    example: { kind: "image", aspect: "16/9", label: "product screenshot" },
  },
  {
    id: "SVG",
    category: "ui",
    source: "velloo",
    props: [
      { name: "content", type: "string | undefined", optional: true, control: "string" },
      { name: "viewBox", type: "string | undefined", optional: true, control: "string" },
      { name: "color", type: "string | undefined", optional: true, control: "color" },
    ],
    example: {
      content: "<path d='M12 2 2 7l10 5 10-5-10-5z' />",
      viewBox: "0 0 24 24",
      color: "primary",
      className: "h-8 w-8",
    },
  },
  {
    id: "Text",
    category: "typography",
    source: "velloo",
    props: [
      {
        name: "variant",
        type: '"muted" | "default" | "small" | "lead" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["muted", "default", "small", "lead"],
      },
    ],
    example: { variant: "muted", children: "Supporting copy." },
  },
];

/**
 * Subset selector mirroring `helpersRegistry` — each provider passes its own
 * deliberate id list and gets the canonical descriptors in that order.
 * Unknown ids are skipped.
 */
export function helperDescriptors(ids: readonly string[]): ComponentDescriptor[] {
  const byId = new Map(HELPER_DESCRIPTORS.map((d) => [d.id, d]));
  const out: ComponentDescriptor[] = [];
  for (const id of ids) {
    const descriptor = byId.get(id);
    if (descriptor) out.push(descriptor);
  }
  return out;
}
