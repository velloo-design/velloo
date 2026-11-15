import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ImageModels, IntentPrice, SketchbookState } from "@velloo/protocol";
import { SketchbookFileSchema } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * A direction's images by kind: the mood board first, the inspiration kinds
 * beside it, page kinds with the mocks, and a Draw menu of the cloud's kinds.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { SketchbookView } = await import("../components/Sketchbook/SketchbookView.tsx");
const { useCanvas } = await import("../store.ts");

const DIR = "assets/sketchbook/sb1/poster";
const at = (n: number) => `2026-11-13T00:00:0${n}Z`;
const img = (name: string, n: number) => ({
  path: `${DIR}/${name}`,
  model: "m",
  prompt: "p",
  createdAt: at(n),
});

const sketchbook = SketchbookFileSchema.parse({
  version: 1,
  stage: "inspiration",
  brief: { origin: "new", product: "Trailhead", page: "the landing page" },
  directions: [
    {
      id: "poster",
      title: "Park poster",
      description: "Screen-printed",
      images: [
        { kind: "moodboard", ...img("board-1.png", 1) },
        { kind: "mock", ...img("mock-1.png", 2) },
      ],
    },
  ],
});
const direction = sketchbook.directions[0];
if (!direction) throw new Error("no direction");
direction.images.push(
  { kind: "palette", ...img("palette-1.png", 3) },
  { kind: "typeposter", ...img("typeposter-1.png", 4) },
  { kind: "mobile", ...img("mobile-1.png", 5) },
);

const kind = (intent: string, label: string, extra: Partial<IntentPrice> = {}): IntentPrice => ({
  intent,
  group: "sketchbook",
  label,
  summary: label,
  priceMicros: 20_000,
  output: "image",
  aspects: ["3:2"],
  defaultAspect: "3:2",
  reference: "optional",
  ...extra,
});

const MODELS: ImageModels = {
  models: [
    {
      id: "velloo-sketch",
      label: "Velloo Sketch",
      summary: "",
      tier: "starter",
      intents: ["moodboard", "mock", "palette", "typeposter", "mobile", "uikit"],
      priceMicros: 30_000,
      locked: false,
    },
  ],
  defaults: { moodboard: "velloo-sketch", mock: "velloo-sketch", palette: "velloo-sketch" },
  unlocked: false,
};

const views: { unmount(): Promise<void> }[] = [];

beforeEach(() => {
  const state: SketchbookState = { id: "sb1", sketchbook, pending: [], promptChars: {} };
  useCanvas.setState({
    view: "sketchbook",
    sketchbookId: "sb1",
    sketchbook: state,
    sketchbookStep: "inspiration",
    sketchbookModels: MODELS,
    sketchbookKinds: [
      kind("moodboard", "Mood board"),
      kind("mock", "Page mock"),
      kind("palette", "Palette in context"),
      kind("typeposter", "Type poster"),
      kind("uikit", "UI kit sheet", { locked: true, tier: "pro" }),
      kind("mobile", "Mobile mock"),
    ],
    sketchbookBusy: [],
    sketchbookFailures: {},
    wsConnected: true,
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

domSuite("sketchbook image kinds", () => {
  test("a direction card shows the mood board, then its other kinds grouped", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const card = $('[data-direction="poster"]') as HTMLElement;
    expect(card.querySelector("img")?.getAttribute("src")).toBe(`/${DIR}/board-1.png`);
    const groups = [...card.querySelectorAll("[data-kind]")].map((g) =>
      g.getAttribute("data-kind"),
    );
    // Inspiration kinds, in the cloud's order; page kinds wait for the mocks step.
    expect(groups).toEqual(["palette", "typeposter"]);
    expect(text(card.querySelector('[data-kind="typeposter"]'))).toContain("Type poster");
  });

  test("the Draw menu lists the cloud's kinds with prices, a locked one disabled", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const trigger = $$("button").find((b) => /^Draw$/.test(text(b).trim()));
    if (!trigger) throw new Error("no Draw menu");
    await interact(() => {
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
    });
    await settle(10);
    const items = $$("[data-slot='dropdown-menu-item']");
    expect(items.map((i) => text(i))).toEqual([
      expect.stringContaining("Mood board"),
      expect.stringContaining("Page mock"),
      expect.stringContaining("Palette in context"),
      expect.stringContaining("Type poster"),
      expect.stringContaining("UI kit sheet"),
      expect.stringContaining("Mobile mock"),
    ]);
    // The price is the model's that would draw it.
    expect(text(items[2] ?? null)).toContain("30");
    expect(items[4]?.getAttribute("data-disabled")).not.toBeNull();
  });

  test("the mocks step shows mobile mocks beside the mocks, and they can be chosen", async () => {
    useCanvas.setState({ sketchbookStep: "mocks" });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const row = $('section[data-direction="poster"]') as HTMLElement;
    expect(row.querySelector('[data-kind="mobile"] img')?.getAttribute("src")).toBe(
      `/${DIR}/mobile-1.png`,
    );
    const choose = [...row.querySelectorAll('[data-kind="mobile"] button')].find(
      (b) => text(b) === "Use as inspiration",
    );
    expect(choose).toBeDefined();
  });
});
