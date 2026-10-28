import type { InitGoal } from "@velloo/protocol/init";

type GoalOption = { value: InitGoal; label: string; hint: string };

const SAMPLE: GoalOption = {
  value: "sample",
  label: "Explore the welcome sample",
  hint: "A travel app with imagery, dark mode and three agentic trip explorations",
};

/**
 * The starts on offer. In an app every one of them begins with the setup,
 * so starting blank there is the setup alone — offered as that. With no app
 * (an empty repo, or a backend with no frontend) there is nothing to set up,
 * and a running site is the only real input left.
 */
export function goalOptions(hasApp: boolean): GoalOption[] {
  if (!hasApp) {
    return [
      {
        value: "capture-site",
        label: "Design from a live site",
        hint: "A browser window opens so you can sign in and capture pages",
      },
      SAMPLE,
      {
        value: "blank",
        label: "Start blank",
        hint: "An empty canvas — you and your agent build from nothing",
      },
    ];
  }
  return [
    {
      value: "setup",
      label: "Just set Velloo up",
      hint: "Find your components, theme and fonts, then propose your design language",
    },
    {
      value: "redesign-screen",
      label: "Redesign a screen",
      hint: "Recreate one of your pages, then explore alternatives",
    },
    {
      value: "redesign-component",
      label: "Redesign a component",
      hint: "One region or widget — recreate it, then try variations",
    },
    {
      value: "capture-site",
      label: "Capture a page",
      hint: "Open your app in a browser, sign in if needed, capture pages — then redesign them",
    },
    {
      value: "custom",
      label: "Design something new",
      hint: "Describe what you need; your agent starts there",
    },
    SAMPLE,
  ];
}
