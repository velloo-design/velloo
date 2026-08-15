import type { ComponentDescriptor, Manifest } from "@velloo/provider";

/**
 * Hand-authored manifest for the no-library provider. Smaller than the
 * shadcn snapshot's auto-generated one (built with ts-morph) — only a
 * dozen entries, easier to maintain by hand than to wire a ts-morph
 * pipeline for. Reused helpers (`Heading`, `Text`, `Icon`, …) get
 * descriptors here too rather than re-loading the shadcn snapshot's
 * manifest at runtime — keeps each provider's manifest self-contained.
 */
export const NONE_MANIFEST: Manifest = [
  {
    id: "Box",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Stack",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "direction",
        type: '"row" | "col" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["row", "col"],
        defaultValue: "col",
      },
      {
        name: "gap",
        type: "number | undefined",
        optional: true,
        control: "number",
        defaultValue: "4",
      },
      {
        name: "align",
        type: '"start" | "center" | "end" | "stretch" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["start", "center", "end", "stretch"],
      },
      {
        name: "justify",
        type: '"start" | "center" | "end" | "between" | "around" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["start", "center", "end", "between", "around"],
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Container",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "size",
        type: '"sm" | "md" | "lg" | "xl" | "full" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["sm", "md", "lg", "xl", "full"],
        defaultValue: "md",
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Card",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Button",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "variant",
        type: '"default" | "ghost" | "outline" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["default", "ghost", "outline"],
        defaultValue: "default",
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Input",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "placeholder",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
      {
        name: "value",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
      {
        name: "type",
        type: "string | undefined",
        optional: true,
        control: "string",
        defaultValue: "text",
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  // Reused velloo helpers — minimal descriptors, the canvas inspector
  // can still tweak className + the recognized props per helper.
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
      {
        name: "children",
        type: "ReactNode",
        optional: true,
        control: "string",
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Text",
    category: "typography",
    source: "velloo",
    props: [
      {
        name: "variant",
        type: '"default" | "muted" | "small" | "lead" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["default", "muted", "small", "lead"],
      },
      {
        name: "children",
        type: "ReactNode",
        optional: true,
        control: "string",
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Icon",
    category: "ui",
    source: "velloo",
    props: [
      { name: "name", type: "string", optional: false, control: "icon" },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Image",
    category: "ui",
    source: "velloo",
    props: [
      { name: "src", type: "string", optional: false, control: "string" },
      { name: "alt", type: "string", optional: false, control: "string" },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "SVG",
    category: "ui",
    source: "velloo",
    props: [
      { name: "content", type: "string", optional: false, control: "string" },
      { name: "viewBox", type: "string", optional: false, control: "string" },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Divider",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
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
      {
        name: "label",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
      {
        name: "aspect",
        type: '"1/1" | "4/3" | "3/4" | "16/9" | "21/9" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["1/1", "4/3", "3/4", "16/9", "21/9"],
      },
    ],
  },
  {
    id: "Layer",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
  {
    id: "Gradient",
    category: "ui",
    source: "velloo",
    props: [
      {
        name: "preset",
        type: '"mesh" | "radial" | "linear" | undefined',
        optional: true,
        control: "enum",
        enumValues: ["mesh", "radial", "linear"],
      },
      {
        name: "className",
        type: "string | undefined",
        optional: true,
        control: "string",
      },
    ],
  },
] satisfies ComponentDescriptor[];
