import type { Page } from "@velloo/schema";

export function buildSamplePage(): Page {
  return {
    name: "Onboarding",
    variants: [
      {
        id: "mobile",
        name: "Mobile",
        viewport: { w: 390, h: 844 },
        tree: {
          $ref: "Card",
          props: { className: "p-6 flex flex-col gap-4" },
          children: [
            {
              $ref: "Heading",
              props: { level: 1, children: "Welcome" },
            },
            {
              $ref: "Text",
              props: { children: "Get started by setting up your account." },
            },
            {
              $ref: "Button",
              props: { variant: "default", children: "Continue" },
            },
          ],
        },
      },
      {
        id: "desktop",
        name: "Desktop",
        viewport: { w: 1440, h: 900 },
        tree: {
          $ref: "Card",
          props: { className: "p-12 flex flex-col gap-6 max-w-xl mx-auto" },
          children: [
            {
              $ref: "Heading",
              props: { level: 1, children: "Welcome" },
            },
            {
              $ref: "Text",
              props: { children: "Get started by setting up your account." },
            },
            {
              $ref: "Button",
              props: { variant: "default", size: "lg", children: "Continue" },
            },
          ],
        },
      },
    ],
  };
}
