import type { Node, Page } from "@velloo/schema";

/** Inner card with no chrome — used as a transparent layout group. */
const group = "flex flex-col gap-1 ring-0 shadow-none bg-transparent p-0";
const groupRow = "flex flex-row items-center gap-2 ring-0 shadow-none bg-transparent p-0";

const BADGE_PALETTE = ["default", "secondary", "destructive", "outline"] as const;

function tutorialCard(
  step: number,
  title: string,
  body: string,
  badge: { variant: (typeof BADGE_PALETTE)[number]; label: string },
  cardClass = "flex flex-col gap-2 p-5",
): Node {
  return {
    $ref: "Card",
    props: { className: cardClass },
    children: [
      {
        $ref: "Card",
        props: {
          className:
            "flex flex-row items-center justify-between gap-3 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          {
            $ref: "Card",
            props: { className: groupRow },
            children: [
              {
                $ref: "Badge",
                props: { variant: "outline", children: String(step) },
              },
              { $ref: "Heading", props: { level: 4, children: title } },
            ],
          },
          { $ref: "Badge", props: { variant: badge.variant, children: badge.label } },
        ],
      },
      { $ref: "Text", props: { variant: "muted", children: body } },
    ],
  };
}

const TUTORIAL_STEPS: {
  title: string;
  body: string;
  badge: { variant: (typeof BADGE_PALETTE)[number]; label: string };
}[] = [
  {
    title: "Click anything",
    body: "Click a button, input, or heading on this canvas. Its props appear on the right — edit text, switch variants, tweak classes.",
    badge: { variant: "default", label: "tip" },
  },
  {
    title: "Sync across variants",
    body: "Toggle “Sync edits” in the right panel. Every change replays across mobile, tablet, and desktop together.",
    badge: { variant: "secondary", label: "feature" },
  },
  {
    title: "Theme it live",
    body: "Switch to the Theme tab. Apply a preset or derive a palette from a seed color. The canvas updates instantly.",
    badge: { variant: "outline", label: "theme" },
  },
  {
    title: "Ship as real code",
    body: "Run `velloo emit ... --all`. Get idiomatic shadcn .tsx you can commit. No runtime, no lock-in.",
    badge: { variant: "destructive", label: "codegen" },
  },
];

function hero(layout: "stacked" | "row"): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-4 p-6" },
    children: [
      {
        $ref: "Card",
        props: { className: groupRow },
        children: [
          { $ref: "Heading", props: { level: 1, children: "Velloo" } },
          { $ref: "Badge", props: { variant: "default", children: "v0" } },
          { $ref: "Badge", props: { variant: "outline", children: "shadcn" } },
        ],
      },
      {
        $ref: "Heading",
        props: { level: 3, children: "Design with code, not pixels." },
      },
      {
        $ref: "Text",
        props: {
          variant: "muted",
          children:
            "Velloo is a design tool for shadcn devs. Designs commit to your repo as JSON; theme exports as Tailwind config. Same components your app already ships.",
        },
      },
      {
        $ref: "Card",
        props: {
          className:
            layout === "row"
              ? "flex flex-row items-center gap-3 ring-0 shadow-none bg-transparent p-0"
              : "flex flex-col gap-2 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Button", props: { variant: "default", size: "lg", children: "Get started" } },
          { $ref: "Button", props: { variant: "outline", size: "lg", children: "Read the docs" } },
          { $ref: "Button", props: { variant: "ghost", size: "lg", children: "Examples" } },
        ],
      },
    ],
  };
}

function tutorialList(): Node {
  return {
    $ref: "Card",
    props: { className: group },
    children: [
      { $ref: "Heading", props: { level: 4, children: "Try these:" } },
      ...TUTORIAL_STEPS.map((s, i) => tutorialCard(i + 1, s.title, s.body, s.badge)),
    ],
  };
}

function tutorialGrid(cols: 2 | 3): Node {
  const grid =
    cols === 3
      ? "grid grid-cols-3 gap-4 ring-0 shadow-none bg-transparent p-0"
      : "grid grid-cols-2 gap-4 ring-0 shadow-none bg-transparent p-0";
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-3 ring-0 shadow-none bg-transparent p-0" },
    children: [
      { $ref: "Heading", props: { level: 4, children: "Try these:" } },
      {
        $ref: "Card",
        props: { className: grid },
        children: TUTORIAL_STEPS.map((s, i) => tutorialCard(i + 1, s.title, s.body, s.badge)),
      },
    ],
  };
}

function signupCard(): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-4 p-6" },
    children: [
      {
        $ref: "Card",
        props: { className: group },
        children: [
          {
            $ref: "Card",
            props: { className: groupRow },
            children: [
              { $ref: "Heading", props: { level: 4, children: "Stay in the loop" } },
              { $ref: "Badge", props: { variant: "secondary", children: "monthly" } },
            ],
          },
          {
            $ref: "Text",
            props: {
              variant: "muted",
              children: "Drop your email — we'll send launch + workshop dates. No spam.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 ring-0 shadow-none bg-transparent p-0" },
        children: [
          { $ref: "Label", props: { htmlFor: "email", children: "Email" } },
          {
            $ref: "Input",
            props: { id: "email", type: "email", placeholder: "you@example.com" },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: groupRow },
        children: [
          {
            $ref: "Button",
            props: { variant: "default", size: "lg", children: "Sign me up" },
          },
          {
            $ref: "Button",
            props: { variant: "ghost", size: "lg", children: "Maybe later" },
          },
        ],
      },
      {
        $ref: "Text",
        props: {
          variant: "small",
          className: "text-center text-muted-foreground",
          children: "Already have an account? Sign in.",
        },
      },
    ],
  };
}

/**
 * A welcome / onboarding page styled like a Velloo tutorial. Each variant
 * walks a new user through the canvas affordances by reading the content on
 * the page. Three variants demonstrate responsive layout from one design.
 */
export function buildSamplePage(): Page {
  return {
    name: "Welcome",
    variants: [
      {
        id: "mobile",
        name: "Mobile",
        viewport: { w: 390, h: 1500 },
        tree: {
          $ref: "Card",
          props: { className: "flex flex-col gap-6 p-6 ring-0 shadow-none bg-transparent" },
          children: [
            hero("stacked"),
            tutorialList(),
            { $ref: "Separator", props: {} },
            signupCard(),
          ],
        },
      },
      {
        id: "desktop",
        name: "Desktop",
        viewport: { w: 1440, h: 1100 },
        tree: {
          $ref: "Card",
          props: {
            className:
              "max-w-6xl mx-auto my-12 flex flex-col gap-8 p-10 ring-0 shadow-none bg-transparent",
          },
          children: [hero("row"), tutorialGrid(3), { $ref: "Separator", props: {} }, signupCard()],
        },
      },
      {
        id: "tablet",
        name: "Tablet",
        viewport: { w: 820, h: 1180 },
        tree: {
          $ref: "Card",
          props: {
            className:
              "max-w-3xl mx-auto my-8 flex flex-col gap-6 p-8 ring-0 shadow-none bg-transparent",
          },
          children: [hero("row"), tutorialGrid(2), { $ref: "Separator", props: {} }, signupCard()],
        },
      },
    ],
  };
}

/* ----------------------------------------------------------------------------
 * Components Demo — every primitive in the snapshot, side by side.
 * Replaces the old Settings page. Useful both as a visual reference for the
 * available palette and as a smoke test of canvas selection / inspection.
 * -------------------------------------------------------------------------- */

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const BUTTON_SIZES = ["xs", "sm", "default", "lg"] as const;

function sectionCard(title: string, description: string, body: Node[]): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-4 p-6" },
    children: [
      {
        $ref: "Card",
        props: { className: group },
        children: [
          { $ref: "Heading", props: { level: 3, children: title } },
          { $ref: "Text", props: { variant: "muted", children: description } },
        ],
      },
      ...body,
    ],
  };
}

function buttonVariantsRow(): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-row flex-wrap gap-2 ring-0 shadow-none bg-transparent p-0" },
    children: BUTTON_VARIANTS.map((v) => ({
      $ref: "Button",
      props: { variant: v, children: v },
    })),
  };
}

function buttonSizesRow(): Node {
  return {
    $ref: "Card",
    props: {
      className: "flex flex-row flex-wrap items-center gap-2 ring-0 shadow-none bg-transparent p-0",
    },
    children: BUTTON_SIZES.map((s) => ({
      $ref: "Button",
      props: { variant: "default", size: s, children: s },
    })),
  };
}

function badgeRow(): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-row flex-wrap gap-2 ring-0 shadow-none bg-transparent p-0" },
    children: [
      { $ref: "Badge", props: { variant: "default", children: "default" } },
      { $ref: "Badge", props: { variant: "secondary", children: "secondary" } },
      { $ref: "Badge", props: { variant: "destructive", children: "destructive" } },
      { $ref: "Badge", props: { variant: "outline", children: "outline" } },
      { $ref: "Badge", props: { variant: "ghost", children: "ghost" } },
      { $ref: "Badge", props: { variant: "link", children: "link" } },
    ],
  };
}

function inputsBlock(): Node {
  return {
    $ref: "Card",
    props: { className: "grid grid-cols-2 gap-4 ring-0 shadow-none bg-transparent p-0" },
    children: [
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 ring-0 shadow-none bg-transparent p-0" },
        children: [
          { $ref: "Label", props: { htmlFor: "demo-name", children: "Name" } },
          {
            $ref: "Input",
            props: { id: "demo-name", placeholder: "Ada Lovelace" },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 ring-0 shadow-none bg-transparent p-0" },
        children: [
          { $ref: "Label", props: { htmlFor: "demo-email", children: "Email" } },
          {
            $ref: "Input",
            props: { id: "demo-email", type: "email", placeholder: "ada@example.com" },
          },
        ],
      },
    ],
  };
}

function typographyBlock(): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-3 ring-0 shadow-none bg-transparent p-0" },
    children: [
      { $ref: "Heading", props: { level: 1, children: "Heading level 1" } },
      { $ref: "Heading", props: { level: 2, children: "Heading level 2" } },
      { $ref: "Heading", props: { level: 3, children: "Heading level 3" } },
      { $ref: "Heading", props: { level: 4, children: "Heading level 4" } },
      {
        $ref: "Text",
        props: {
          variant: "default",
          children: "Body text. The default Text variant — paragraphs, copy, anything narrative.",
        },
      },
      {
        $ref: "Text",
        props: {
          variant: "muted",
          children: "Muted text. Use this for descriptions, captions, supporting copy.",
        },
      },
      {
        $ref: "Text",
        props: {
          variant: "lead",
          children: "Lead text. Slightly larger, used for opening paragraphs.",
        },
      },
      {
        $ref: "Text",
        props: {
          variant: "small",
          children: "Small text. Footnotes, fine print, microcopy.",
        },
      },
    ],
  };
}

function cardLibrary(): Node {
  return {
    $ref: "Card",
    props: { className: "grid grid-cols-2 gap-4 ring-0 shadow-none bg-transparent p-0" },
    children: [
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 p-5" },
        children: [
          { $ref: "Heading", props: { level: 4, children: "Standard Card" } },
          {
            $ref: "Text",
            props: {
              variant: "muted",
              children: "The default Card — subtle ring, rounded, no shadow.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 p-5 ring-2 ring-primary" },
        children: [
          { $ref: "Heading", props: { level: 4, children: "Emphasized" } },
          {
            $ref: "Text",
            props: {
              variant: "muted",
              children: "Override classes to tint or thicken the ring for emphasis.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 p-5 bg-secondary text-secondary-foreground" },
        children: [
          { $ref: "Heading", props: { level: 4, children: "Tinted" } },
          {
            $ref: "Text",
            props: {
              variant: "muted",
              children: "Use theme tokens to tint backgrounds without leaving the palette.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: { className: "flex flex-col gap-2 p-5 bg-destructive/10" },
        children: [
          {
            $ref: "Card",
            props: { className: groupRow },
            children: [
              { $ref: "Heading", props: { level: 4, children: "Warning" } },
              { $ref: "Badge", props: { variant: "destructive", children: "alert" } },
            ],
          },
          {
            $ref: "Text",
            props: {
              variant: "muted",
              children: "Wash a Card in destructive/10 for inline warnings without a full alert.",
            },
          },
        ],
      },
    ],
  };
}

/** A page that puts every primitive on screen — useful as a visual reference. */
export function buildComponentsPage(): Page {
  return {
    name: "Components",
    variants: [
      {
        id: "desktop",
        name: "Desktop",
        viewport: { w: 1440, h: 1800 },
        tree: {
          $ref: "Card",
          props: {
            className:
              "max-w-5xl mx-auto my-12 flex flex-col gap-8 p-10 ring-0 shadow-none bg-transparent",
          },
          children: [
            {
              $ref: "Card",
              props: { className: group },
              children: [
                {
                  $ref: "Card",
                  props: { className: groupRow },
                  children: [
                    { $ref: "Heading", props: { level: 1, children: "Components" } },
                    { $ref: "Badge", props: { variant: "outline", children: "snapshot" } },
                  ],
                },
                {
                  $ref: "Text",
                  props: {
                    variant: "muted",
                    children:
                      "Every primitive in the pinned shadcn snapshot. Click any one to inspect its props on the right.",
                  },
                },
              ],
            },
            sectionCard("Buttons", "Variants and sizes from the snapshot.", [
              buttonVariantsRow(),
              { $ref: "Separator", props: { className: "my-1" } },
              buttonSizesRow(),
            ]),
            sectionCard("Badges", "All variants available out of the box.", [badgeRow()]),
            sectionCard("Inputs", "Labels + inputs are the form-field primitive pair.", [
              inputsBlock(),
            ]),
            sectionCard("Typography", "Heading levels 1–4 plus the Text variants.", [
              typographyBlock(),
            ]),
            sectionCard("Cards", "Compose Cards to tint, emphasize, or warn.", [cardLibrary()]),
            sectionCard("Separator", "A horizontal rule themed against the border token.", [
              { $ref: "Separator", props: {} },
            ]),
          ],
        },
      },
    ],
  };
}
