import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  type GenerateSketchbookBody,
  type ImageModels,
  REVISION_NUDGES,
  type SketchbookState,
  type UpdateSketchbookBody,
} from "@velloo/protocol";
import { SketchbookFileSchema } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";

/**
 * References on the brief and directions steps, a direction's own, the remix
 * dialog, and the nudges on a mood board.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));
mock.module("../api/sketchbook.ts", () => ({
  sketchbook: { pages: async () => ({ pages: [] }) },
  proposalSpecimenSrc: () => "",
}));

const { SketchbookView } = await import("../components/Sketchbook/SketchbookView.tsx");
const { useCanvas } = await import("../store.ts");

const DIR = "assets/sketchbook/sb1";
const image = (kind: string, name: string) => ({
  kind,
  path: `${DIR}/${name}`,
  model: "m",
  prompt: "p",
  createdAt: "2026-11-13T00:00:00Z",
});

const sketchbook = SketchbookFileSchema.parse({
  version: 1,
  stage: "boards",
  brief: { origin: "new", product: "Trailhead", page: "the landing page" },
  references: [
    {
      id: "linear",
      path: `${DIR}/refs/linear.png`,
      url: "https://linear.app/",
      note: "the dark palette",
      createdAt: "2026-11-13T00:00:00Z",
    },
  ],
  directions: [
    {
      id: "poster",
      title: "Park poster",
      description: "Screen-printed",
      images: [image("moodboard", "poster/board-1.png")],
      references: ["linear"],
    },
    {
      id: "instrument",
      title: "Field instrument",
      description: "Swiss grid",
      remixOf: ["poster", "poster"],
    },
    {
      id: "mix",
      title: "Mix",
      description: "Both",
      remixOf: ["poster", "instrument"],
      take: "colour from Park poster",
    },
  ],
});

const MODELS: ImageModels = {
  models: [
    {
      id: "velloo-sketch",
      label: "Velloo Sketch",
      summary: "",
      tier: "starter",
      intents: ["moodboard", "mock"],
      priceMicros: 30_000,
      locked: false,
    },
  ],
  defaults: { moodboard: "velloo-sketch", mock: "velloo-sketch" },
  unlocked: false,
};

const views: { unmount(): Promise<void> }[] = [];
let updates: UpdateSketchbookBody[];
let draws: GenerateSketchbookBody[];

beforeEach(() => {
  updates = [];
  draws = [];
  const state: SketchbookState = { id: "sb1", sketchbook, pending: [], promptChars: {} };
  useCanvas.setState({
    view: "sketchbook",
    sketchbookId: "sb1",
    sketchbook: state,
    sketchbookStep: "directions",
    sketchbookModels: MODELS,
    sketchbookKinds: [],
    sketchbookBusy: [],
    sketchbookFailures: {},
    wsConnected: true,
    updateSketchbook: async (body: UpdateSketchbookBody) => {
      updates.push(body);
    },
    generateSketchbook: async (body: GenerateSketchbookBody) => {
      draws.push(body);
      return { made: [], failed: [] };
    },
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

const button = (label: RegExp) => {
  const found = $$("button").find((b) => label.test(text(b).trim()));
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

const openMenu = (trigger: HTMLElement) =>
  interact(() => {
    trigger.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
  });

domSuite("sketchbook references, remix and nudges", () => {
  test("the directions step lists the references, and a URL is added as one", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const panel = $("[data-sketchbook-references]") as HTMLElement;
    expect(panel.querySelector('[data-reference="linear"] img')?.getAttribute("src")).toBe(
      `/${DIR}/refs/linear.png`,
    );
    expect(text(panel)).toContain("linear.app");
    const address = panel.querySelector(
      'input[aria-label="A page\'s address"]',
    ) as HTMLInputElement;
    await interact(() => typeInto(address, "example.com"));
    await interact(() => button(/^Add page$/).click());
    await settle(10);
    expect(updates).toContainEqual({ references: [{ url: "https://example.com" }] });
  });

  test("a direction toggles the references it is drawn from, and a remix says what it took", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const card = $('[data-direction="instrument"]') as HTMLElement;
    const ref = card.querySelector('button[aria-pressed="false"]') as HTMLElement;
    await interact(() => ref.click());
    expect(updates).toContainEqual({ directions: [{ id: "instrument", references: ["linear"] }] });
    expect(text($('[data-direction="mix"] [data-remix-of]'))).toBe(
      "A remix of Park poster and Field instrument: colour from Park poster",
    );
  });

  test("remixing two directions sends what to take from each", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    await interact(() => button(/^Remix two$/).click());
    await settle(10);
    const take = $("#sketchbook-remix-take") as HTMLTextAreaElement;
    expect(take.value).toBe("colour from Park poster, type and texture from Field instrument");
    await interact(() => button(/^Remix$/).click());
    await settle(10);
    expect(updates).toContainEqual({
      remix: {
        from: ["poster", "instrument"],
        take: "colour from Park poster, type and texture from Field instrument",
      },
    });
  });

  test("a mood board is nudged bolder, beside itself", async () => {
    useCanvas.setState({ sketchbookStep: "boards" });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const card = $('[data-direction="poster"]') as HTMLElement;
    const trigger = [...card.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Change this mood board",
    ) as HTMLElement;
    await openMenu(trigger);
    await settle(10);
    const items = $$("[data-slot='dropdown-menu-item']");
    expect(items.map((i) => text(i).replace(/[\d.,\s]+$/, ""))).toEqual([
      expect.stringContaining("Bolder"),
      expect.stringContaining("Quieter"),
      "Change…",
    ]);
    await interact(() => items[0]?.click());
    await settle(10);
    expect(draws).toContainEqual({
      kind: "moodboard",
      directions: ["poster"],
      count: 1,
      revise: { image: `${DIR}/poster/board-1.png`, instruction: REVISION_NUDGES.bolder },
    });
  });
});
