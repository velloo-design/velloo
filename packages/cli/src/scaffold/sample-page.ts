/**
 * Sample design shipped by `velloo init`. The screens, snippets, board layout,
 * and theme are kept as canonical JSON under ./pulse/ — easier to iterate on
 * inside the canvas, then re-copy here when something improves.
 *
 * The sample is "Pulse" — a fictional team-analytics product for engineering
 * teams. Three boards (App + Marketing + Playground), seven screens. Every
 * color uses semantic theme tokens so it adapts cleanly to dark mode.
 * Playground hosts the components showcase — every component Velloo ships
 * on one screen, useful as a visual reference for what's available to
 * designs.
 */
import type { Board, Screen } from "@velloo/schema";

import appBoard from "./pulse/boards/app.json" with { type: "json" };
import marketingBoard from "./pulse/boards/marketing.json" with { type: "json" };
import playgroundBoard from "./pulse/boards/playground.json" with { type: "json" };
import dashboard from "./pulse/screens/dashboard.json" with { type: "json" };
import insights from "./pulse/screens/insights.json" with { type: "json" };
import landing from "./pulse/screens/landing.json" with { type: "json" };
import pricing from "./pulse/screens/pricing.json" with { type: "json" };
import settings from "./pulse/screens/settings.json" with { type: "json" };
import showcase from "./pulse/screens/showcase.json" with { type: "json" };
import signup from "./pulse/screens/signup.json" with { type: "json" };

/**
 * What the user is designing — tailors which slice of Pulse ships.
 * `saas` is the whole product (the historical default); `analytics` keeps
 * the App board (dashboard / insights / settings); `marketing` keeps the
 * Marketing board (landing / pricing / sign-up). Every surface keeps
 * Playground — the component showcase is reference material, not product.
 */
export type ProductSurface = "saas" | "analytics" | "marketing";

export const PRODUCT_SURFACES: ProductSurface[] = ["saas", "analytics", "marketing"];

const APP_SCREENS = [dashboard, insights, settings] as Screen[];
const MARKETING_SCREENS = [landing, pricing, signup] as Screen[];

export function buildSampleScreens(surface: ProductSurface = "saas"): Screen[] {
  if (surface === "analytics") return [...APP_SCREENS, showcase as Screen];
  if (surface === "marketing") return [...MARKETING_SCREENS, showcase as Screen];
  return [...MARKETING_SCREENS, ...APP_SCREENS, showcase as Screen];
}

export function buildSampleBoards(surface: ProductSurface = "saas"): Board[] {
  if (surface === "analytics") return [appBoard as Board, playgroundBoard as Board];
  if (surface === "marketing") return [marketingBoard as Board, playgroundBoard as Board];
  return [appBoard as Board, marketingBoard as Board, playgroundBoard as Board];
}
