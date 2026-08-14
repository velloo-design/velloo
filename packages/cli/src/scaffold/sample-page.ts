/**
 * Sample design shipped by `velloo init`. The screens, snippets, board layout,
 * and theme are kept as canonical JSON under ./pulse/ — easier to iterate on
 * inside the canvas, then re-copy here when something improves.
 *
 * The sample is "Pulse" — a fictional team-analytics product for engineering
 * teams. Two boards (Marketing + App), six screens (landing, pricing, signup,
 * dashboard, insights, settings). Every color uses semantic theme tokens so
 * it adapts cleanly to dark mode.
 */
import type { Board, Screen } from "@velloo/schema";

import appBoard from "./pulse/boards/app.json" with { type: "json" };
import marketingBoard from "./pulse/boards/marketing.json" with { type: "json" };
import dashboard from "./pulse/screens/dashboard.json" with { type: "json" };
import insights from "./pulse/screens/insights.json" with { type: "json" };
import landing from "./pulse/screens/landing.json" with { type: "json" };
import pricing from "./pulse/screens/pricing.json" with { type: "json" };
import settings from "./pulse/screens/settings.json" with { type: "json" };
import signup from "./pulse/screens/signup.json" with { type: "json" };

export function buildSampleScreens(): Screen[] {
  return [
    landing as Screen,
    pricing as Screen,
    signup as Screen,
    dashboard as Screen,
    insights as Screen,
    settings as Screen,
  ];
}

export function buildSampleBoards(): Board[] {
  return [marketingBoard as Board, appBoard as Board];
}
