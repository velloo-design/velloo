import type { Node, Page } from "@velloo/schema";

/**
 * A Velloo-themed welcome / onboarding page. Demonstrates Card composition,
 * Badge, Input + Label, Separator, and the typography primitives in a layout
 * that feels like a real product onboarding screen.
 */
export function buildSamplePage(): Page {
  return {
    name: "Welcome",
    variants: [
      { id: "mobile", name: "Mobile", viewport: { w: 390, h: 844 }, tree: welcomeTree("mobile") },
      {
        id: "desktop",
        name: "Desktop",
        viewport: { w: 1440, h: 900 },
        tree: welcomeTree("desktop"),
      },
    ],
  };
}

function welcomeTree(form: "mobile" | "desktop"): Node {
  const padding = form === "mobile" ? "p-6" : "p-10";
  const maxWidth = form === "mobile" ? "" : "max-w-md mx-auto mt-24";
  return {
    $ref: "Card",
    props: { className: `${padding} flex flex-col gap-6 ${maxWidth}`.trim() },
    children: [
      {
        $ref: "Card",
        props: {
          className: "flex flex-row items-center gap-2 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Heading", props: { level: 1, children: "Velloo" } },
          {
            $ref: "Badge",
            props: { variant: "secondary", children: "v0" },
          },
        ],
      },
      {
        $ref: "Text",
        props: {
          variant: "muted",
          children:
            "The design tool for shadcn devs. Designs commit to your repo as JSON; theme exports as Tailwind config.",
        },
      },
      { $ref: "Separator", props: {} },
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
        props: {
          variant: "default",
          size: form === "mobile" ? "default" : "lg",
          children: "Continue",
        },
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
              props: { className: "flex flex-col gap-1 ring-0 shadow-none bg-transparent p-0" },
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
    props: { className: "flex flex-col gap-1 ring-0 shadow-none bg-transparent p-0" },
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
