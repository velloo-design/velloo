import type { Snippet } from "@velloo/schema";

/**
 * A small starter library of reusable snippets so users see the feature
 * the first time they open the canvas. Each one shows a different angle:
 * one with a single string param, one with multiple params, one with a
 * `node` param for slot composition.
 */
export function buildSampleSnippets(): Snippet[] {
  const featureCard: Snippet = {
    id: "feature-card",
    name: "Feature Card",
    params: [
      { name: "title", type: "string" },
      { name: "body", type: "string" },
      { name: "icon", type: "string", default: "Sparkles" },
    ],
    tree: {
      $ref: "Card",
      props: { className: "p-6 flex flex-col gap-3" },
      children: [
        {
          $ref: "Icon",
          props: { name: { $param: "icon" }, className: "h-6 w-6 text-primary" },
        },
        {
          $ref: "Heading",
          props: { level: 3, children: { $param: "title" } },
        },
        {
          $ref: "Text",
          props: { variant: "muted", children: { $param: "body" } },
        },
      ],
    },
  };

  const sectionHeader: Snippet = {
    id: "section-header",
    name: "Section Header",
    params: [
      { name: "title", type: "string" },
      { name: "subtitle", type: "string", default: "" },
    ],
    tree: {
      $ref: "Card",
      props: { className: "p-0 border-0 shadow-none bg-transparent flex flex-col gap-2" },
      children: [
        {
          $ref: "Heading",
          props: {
            level: 2,
            className: "text-3xl tracking-tight",
            children: { $param: "title" },
          },
        },
        {
          $ref: "Text",
          props: { variant: "muted", children: { $param: "subtitle" } },
        },
      ],
    },
  };

  return [featureCard, sectionHeader];
}
