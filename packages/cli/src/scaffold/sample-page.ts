import type { Node, Page } from "@velloo/schema";

/** Inner card with no chrome — used as a transparent layout group. */
const groupClass = "flex flex-col gap-1 ring-0 shadow-none bg-transparent p-0";

function tutorialCard(title: string, body: string, badge: string): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-2 p-5" },
    children: [
      {
        $ref: "Card",
        props: {
          className:
            "flex flex-row items-center justify-between gap-2 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Heading", props: { level: 4, children: title } },
          { $ref: "Badge", props: { variant: "secondary", children: badge } },
        ],
      },
      { $ref: "Text", props: { variant: "muted", children: body } },
    ],
  };
}

const TUTORIAL_STEPS: { title: string; body: string; badge: string }[] = [
  {
    title: "1. Click anything",
    badge: "tip",
    body: "Click a button, input, or heading on this canvas. Its props appear on the right — edit text, switch variants, tweak classes.",
  },
  {
    title: "2. Sync across variants",
    badge: "feature",
    body: "Toggle “Sync edits” in the right panel. Edits replay across every variant, so mobile and desktop stay in lockstep while you iterate.",
  },
  {
    title: "3. Theme it live",
    badge: "theme",
    body: "Switch to the Theme tab on the right. Apply a preset or derive a palette from a seed color. The canvas updates instantly.",
  },
  {
    title: "4. Ship as real code",
    badge: "codegen",
    body: "Run `velloo emit … --all --to ./app/{variant}/page.tsx`. Get idiomatic shadcn JSX you can commit. No runtime, no lock-in.",
  },
];

function hero(layout: "stacked" | "row"): Node {
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-4 p-6" },
    children: [
      {
        $ref: "Card",
        props: {
          className: "flex flex-row items-center gap-2 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Heading", props: { level: 1, children: "Velloo" } },
          { $ref: "Badge", props: { variant: "secondary", children: "v0" } },
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
          { $ref: "Button", props: { variant: "default", children: "Get started" } },
          { $ref: "Button", props: { variant: "outline", children: "Read the docs" } },
        ],
      },
    ],
  };
}

function tutorialList(): Node {
  return {
    $ref: "Card",
    props: { className: groupClass },
    children: [
      { $ref: "Heading", props: { level: 4, children: "Try these:" } },
      ...TUTORIAL_STEPS.map((s) => tutorialCard(s.title, s.body, s.badge)),
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
        children: TUTORIAL_STEPS.map((s) => tutorialCard(s.title, s.body, s.badge)),
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
        props: { className: groupClass },
        children: [
          { $ref: "Heading", props: { level: 4, children: "Stay in the loop" } },
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
        $ref: "Button",
        props: { variant: "default", size: "lg", children: "Sign me up" },
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

/**
 * A settings page with profile / account / notifications sections — matches
 * the launch demo script in docs/v0.md.
 */
export function buildSettingsPage(): Page {
  return {
    name: "Settings",
    variants: [
      {
        id: "desktop",
        name: "Desktop",
        viewport: { w: 1440, h: 900 },
        tree: {
          $ref: "Card",
          props: { className: "max-w-3xl mx-auto my-12 p-10 flex flex-col gap-8" },
          children: [
            {
              $ref: "Card",
              props: { className: groupClass },
              children: [
                { $ref: "Heading", props: { level: 1, children: "Settings" } },
                {
                  $ref: "Text",
                  props: {
                    variant: "muted",
                    children: "Manage your profile, account, and notification preferences.",
                  },
                },
              ],
            },
            settingsSection("Profile", "How you appear across Velloo.", [
              { name: "Name", placeholder: "Ada Lovelace" },
              { name: "Username", placeholder: "ada" },
            ]),
            settingsSection("Account", "Sign-in and security.", [
              { name: "Email", placeholder: "ada@example.com", type: "email" },
            ]),
            settingsSection("Notifications", "Pick what reaches your inbox.", []),
            {
              $ref: "Card",
              props: { className: "flex flex-row gap-3 ring-0 shadow-none bg-transparent p-0" },
              children: [
                { $ref: "Button", props: { variant: "default", children: "Save changes" } },
                { $ref: "Button", props: { variant: "ghost", children: "Cancel" } },
              ],
            },
          ],
        },
      },
    ],
  };
}

function settingsSection(
  title: string,
  description: string,
  fields: { name: string; placeholder: string; type?: string }[],
): Node {
  const headerCard: Node = {
    $ref: "Card",
    props: { className: groupClass },
    children: [
      { $ref: "Heading", props: { level: 3, children: title } },
      { $ref: "Text", props: { variant: "muted", children: description } },
    ],
  };
  const fieldNodes: Node[] = fields.map((f) => ({
    $ref: "Card",
    props: { className: "flex flex-col gap-2 ring-0 shadow-none bg-transparent p-0" },
    children: [
      { $ref: "Label", props: { htmlFor: f.name.toLowerCase(), children: f.name } },
      {
        $ref: "Input",
        props: {
          id: f.name.toLowerCase(),
          type: f.type ?? "text",
          placeholder: f.placeholder,
        },
      },
    ],
  }));
  return {
    $ref: "Card",
    props: { className: "flex flex-col gap-4 p-6" },
    children: [headerCard, ...fieldNodes].concat({
      $ref: "Separator",
      props: { className: "opacity-0" }, // visual breathing room without an actual rule
    }),
  };
}
