import { helperDescriptors } from "@velloo/helpers";
import type { ComponentDescriptor, Manifest } from "@velloo/provider";
import { REUSED_HELPER_IDS } from "./registry.ts";

/**
 * Manifest for the no-library provider. The six bare primitives are
 * hand-authored (a dozen props, easier to maintain by hand than to wire a
 * ts-morph pipeline for); the reused helpers (`Heading`, `Text`, `Icon`, …)
 * come from `@velloo/helpers`' canonical descriptors so the props the
 * inspector sees can't drift from the components the registry renders.
 */
const PRIMITIVE_DESCRIPTORS: ComponentDescriptor[] = [
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
] satisfies ComponentDescriptor[];

export const NONE_MANIFEST: Manifest = [
  ...PRIMITIVE_DESCRIPTORS,
  // Reused velloo helpers — the same canonical descriptors the shadcn
  // snapshot's generated manifest carries (minus the build-time lucide
  // name sampling for `Icon`).
  ...helperDescriptors(REUSED_HELPER_IDS),
];
