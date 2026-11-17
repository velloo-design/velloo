import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type {
  ContrastPair,
  GenerateSketchbookBody,
  ImageModels,
  IntentPrice,
  SketchbookState,
  UpdateSketchbookBody,
} from "@velloo/protocol";
import { type SketchbookFile, SketchbookFileSchema } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";

/**
 * The sketchbook's stages after the brief: directions with their tokens and
 * the inspiration picker, the inspiration drawn, the screens chosen per
 * direction, and the rail's account of each.
 */

const pair = (label: string, mode: "light" | "dark", tier: ContrastPair["tier"]): ContrastPair => ({
  label,
  mode,
  fg: "#111111",
  bg: "#ffffff",
  ratio: tier === "Fail" ? 2.1 : tier === "AAlarge" ? 3.4 : 7.2,
  tier,
});

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));
mock.module("../api/sketchbook.ts", () => ({
  sketchbook: {
    pages: async () => ({ pages: [], hasApp: false }),
    proposal: async () => ({
      contrast: [
        pair("foreground on background", "light", "AA"),
        pair("muted-foreground on muted", "light", "AAlarge"),
        pair("foreground on background", "dark", "Fail"),
        pair("muted-foreground on muted", "dark", "Fail"),
      ],
    }),
  },
  proposalSpecimenSrc: () => "about:blank",
}));

const { SketchbookView } = await import("../components/Sketchbook/SketchbookView.tsx");
const { SketchbookRail } = await import("../components/Sketchbook/SketchbookRail.tsx");
const { useCanvas } = await import("../store.ts");

const DIR = "assets/sketchbook/sb1";
const image = (kind: string, name: string) => ({
  kind,
  path: `${DIR}/${name}`,
  model: "m",
  prompt: "p",
  createdAt: "2026-11-15T00:00:00Z",
});

const file = (over: Record<string, unknown> = {}): SketchbookFile =>
  SketchbookFileSchema.parse({
    version: 1,
    stage: "directions",
    brief: { origin: "new", product: "Trailhead", page: "the landing page" },
    directions: [
      {
        id: "poster",
        title: "Park poster",
        description: "Screen-printed, #2f4a3a and cream",
        images: [image("moodboard", "poster/board-1.png")],
        proposal: { tokens: { "colors.primary.DEFAULT": "#2f4a3a" }, fonts: [] },
      },
      { id: "instrument", title: "Field instrument", description: "Swiss grid" },
      { id: "quiet", title: "Quiet", description: "Muted", picked: false },
    ],
    ...over,
  });

const kind = (intent: string, label: string): IntentPrice => ({
  intent,
  group: "sketchbook",
  label,
  summary: label,
  priceMicros: 20_000,
  output: "image",
  aspects: ["3:2"],
  defaultAspect: "3:2",
  reference: "optional",
});

const KINDS = [
  kind("moodboard", "Mood board"),
  kind("mock", "Page mock"),
  kind("palette", "Palette in context"),
  kind("typeposter", "Type poster"),
  kind("uikit", "UI kit sheet"),
  kind("imagery", "Imagery style"),
  kind("icons", "Icons and motifs"),
  kind("mobile", "Mobile mock"),
];

const MODELS: ImageModels = {
  models: [
    {
      id: "velloo-sketch",
      label: "Velloo Sketch",
      summary: "",
      tier: "starter",
      intents: KINDS.map((k) => k.intent),
      priceMicros: 30_000,
      locked: false,
    },
  ],
  defaults: Object.fromEntries(KINDS.map((k) => [k.intent, "velloo-sketch"])),
  unlocked: false,
};

const views: { unmount(): Promise<void> }[] = [];
let updates: UpdateSketchbookBody[];
let draws: GenerateSketchbookBody[];

function open(sketchbook: SketchbookFile) {
  const state: SketchbookState = { id: "sb1", sketchbook, pending: [], promptChars: {} };
  useCanvas.setState({ sketchbook: state, sketchbookStep: sketchbook.stage });
}

beforeEach(() => {
  updates = [];
  draws = [];
  useCanvas.setState({
    view: "sketchbook",
    sketchbookId: "sb1",
    sketchbookModels: MODELS,
    sketchbookKinds: KINDS,
    sketchbookBusy: [],
    sketchbookFailures: {},
    sketchbooks: [],
    wsConnected: true,
    updateSketchbook: async (body: UpdateSketchbookBody) => {
      updates.push(body);
    },
    generateSketchbook: async (body: GenerateSketchbookBody) => {
      draws.push(body);
      return { made: [], failed: [] };
    },
  });
  open(file());
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

const button = (label: RegExp, within: ParentNode = document) => {
  const found = [...within.querySelectorAll("button")].find((b) => label.test(text(b).trim()));
  if (!found) throw new Error(`no button ${label}`);
  return found as HTMLElement;
};

const openMenu = (trigger: HTMLElement) =>
  interact(() => {
    trigger.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
  });

domSuite("sketchbook directions with their tokens", () => {
  test("a card shows its words beside its specimen, or that the agent is proposing tokens", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const poster = $('[data-direction="poster"]') as HTMLElement;
    expect(text(poster)).toContain("Screen-printed");
    expect(poster.querySelector('[data-proposal="poster"]')).not.toBeNull();
    const instrument = $('[data-direction="instrument"]') as HTMLElement;
    expect(instrument.querySelector("[data-proposal]")).toBeNull();
    expect(text(instrument.querySelector("[data-tokens-pending]"))).toContain(
      "Your agent is proposing tokens",
    );
  });

  test("Keep and Drop set whether the direction goes on", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const poster = $('[data-direction="poster"]') as HTMLElement;
    // The choice sits with the card's other actions, at its foot.
    expect(poster.querySelector("[data-slot='card-header'] [role='group']")).toBeNull();
    const footer = poster.querySelector("[data-slot='card-footer']") as HTMLElement;
    expect(button(/^Keep$/, footer).getAttribute("data-state")).toBe("on");
    await interact(() => button(/^Drop$/, footer).click());
    expect(updates).toContainEqual({ directions: [{ id: "poster", picked: false }] });
    const quiet = $('[data-direction="quiet"]') as HTMLElement;
    expect(quiet.getAttribute("data-kept")).toBe("false");
    await interact(() => button(/^Keep$/, quiet).click());
    expect(updates).toContainEqual({ directions: [{ id: "quiet", picked: true }] });
  });

  test("the contrast section folds under a header that explains itself and counts the scheme shown", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(20);
    const poster = $('[data-direction="poster"]') as HTMLElement;
    const contrast = () => poster.querySelector("[data-contrast]") as HTMLElement;
    expect(text(contrast())).toContain("Contrast");
    expect(
      contrast().querySelector('[aria-label="What the contrast check covers"]'),
    ).not.toBeNull();
    expect(text(contrast().querySelector("[data-slot='badge']"))).toBe("1 pair under AA in light");
    // Folded until opened.
    expect(contrast().querySelectorAll("li")).toHaveLength(0);
    await interact(() => button(/^Contrast$/, contrast()).click());
    expect(contrast().querySelectorAll("li")).toHaveLength(2);
    await interact(() => button(/^Dark$/, poster).click());
    await settle(10);
    expect(text(contrast())).toContain("2 pairs under AA in dark");
    expect(contrast().querySelectorAll("li[data-tier='Fail']")).toHaveLength(2);
  });

  test("a scheme with every pair at AA says so quietly", async () => {
    const { sketchbook: api } = await import("../api/sketchbook.ts");
    const proposal = api.proposal;
    api.proposal = async () => ({ contrast: [pair("foreground on background", "light", "AA")] });
    try {
      views.push(await mount(<SketchbookView />));
      await settle(20);
      const contrast = $('[data-direction="poster"] [data-contrast]') as HTMLElement;
      expect(contrast.querySelector("[data-slot='badge']")).toBeNull();
      expect(text(contrast)).toContain("passes AA");
    } finally {
      api.proposal = proposal;
    }
  });

  test("the picker offers the subject's top kinds, the rest under More, and draws them with a custom image", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const picker = $("[data-inspiration-picker]") as HTMLElement;
    const toggles = [...picker.querySelectorAll("[data-slot='toggle-group-item']")];
    expect(toggles.map((t) => text(t))).toEqual(["Mood board", "UI kit sheet", "Imagery style"]);
    // The mood board is picked until the person picks.
    expect(toggles[0]?.getAttribute("data-state")).toBe("on");
    await interact(() => (toggles[1] as HTMLElement).click());

    await openMenu(button(/^More/, picker));
    await settle(10);
    expect($$("[data-slot='dropdown-menu-checkbox-item']").map((i) => text(i))).toEqual([
      expect.stringContaining("Palette in context"),
      expect.stringContaining("Type poster"),
      expect.stringContaining("Icons and motifs"),
      // Velloo knows it; this cloud doesn't list it.
      expect.stringContaining("Not on your cloud yet"),
    ]);
    expect(text($("[data-slot='dropdown-menu-checkbox-item'][data-unavailable]"))).toContain(
      "Detail close-up",
    );
    await interact(() => press(document.activeElement ?? document.body, "Escape"));

    const custom = picker.querySelector('input[aria-label="A custom image"]') as HTMLInputElement;
    await interact(() => typeInto(custom, "the product on a desk at night"));
    // Mood board for the one without it, UI kits and the custom image for both kept.
    const draw = button(/^Draw inspiration/, picker);
    expect(text(draw)).toContain("5 images");
    await interact(() => draw.click());
    await settle(10);
    expect(updates).toContainEqual({
      inspiration: { kinds: ["moodboard", "uikit"], custom: "the product on a desk at night" },
    });
    expect(draws).toEqual([
      { kind: "moodboard", directions: ["instrument"] },
      { kind: "uikit", directions: ["poster", "instrument"] },
      {
        kind: "custom",
        directions: ["poster", "instrument"],
        ask: "the product on a desk at night",
      },
    ]);
    expect(updates).toContainEqual({ stage: "inspiration" });
    expect(useCanvas.getState().sketchbookStep).toBe("inspiration");
  });

  test("a Look's picker starts from palettes and type, and the stages can be skipped", async () => {
    open(file({ subject: "look" }));
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const picker = $("[data-inspiration-picker]") as HTMLElement;
    expect(
      [...picker.querySelectorAll("[data-slot='toggle-group-item']")].map((t) => text(t)),
    ).toEqual(["Palette in context", "Type poster", "Mood board"]);
    await interact(() => button(/^Skip to mocks$/, picker).click());
    expect(updates).toContainEqual({ stage: "mocks" });
    expect(useCanvas.getState().sketchbookStep).toBe("mocks");
  });

  test("kinds a cloud doesn't draw yet are shown, unavailable, and left out of the draw and its price", async () => {
    const older = KINDS.filter((k) => k.intent === "moodboard" || k.intent === "mock");
    useCanvas.setState({ sketchbookKinds: older });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const picker = $("[data-inspiration-picker]") as HTMLElement;
    const toggles = [...picker.querySelectorAll("[aria-label='Inspiration to draw'] button")];
    expect(toggles.map((t) => text(t))).toEqual(["Mood board", "UI kit sheet", "Imagery style"]);
    expect(toggles.map((t) => t.getAttribute("data-unavailable"))).toEqual([
      null,
      "Your Velloo cloud doesn't draw this yet",
      "Your Velloo cloud doesn't draw this yet",
    ]);
    // Picking one does nothing.
    await interact(() => (toggles[1] as HTMLElement).click());
    expect(toggles[1]?.getAttribute("aria-pressed")).toBe("false");
    const custom = picker.querySelector('input[aria-label="A custom image"]') as HTMLInputElement;
    expect(custom.disabled).toBe(true);

    await openMenu(button(/^More/, picker));
    await settle(10);
    const more = $$("[data-slot='dropdown-menu-checkbox-item']");
    expect(more.map((i) => text(i))).toEqual([
      "Palette in contextNot on your cloud yet",
      "Type posterNot on your cloud yet",
      "Icons and motifsNot on your cloud yet",
      "Detail close-upNot on your cloud yet",
    ]);
    expect(more.every((i) => i.hasAttribute("data-disabled"))).toBe(true);
    await interact(() => press(document.activeElement ?? document.body, "Escape"));

    // One mood board, for the direction without one; 0.03 credits a piece.
    const draw = button(/^Draw inspiration/, picker);
    expect(text(draw)).toContain("1 image");
    await interact(() => draw.click());
    await settle(10);
    expect(draws).toEqual([{ kind: "moodboard", directions: ["instrument"] }]);
  });
});

domSuite("sketchbook inspiration and screens", () => {
  test("the Draw menu lists every kind Velloo knows, the ones the cloud doesn't draw unavailable", async () => {
    useCanvas.setState({
      sketchbookKinds: KINDS.filter((k) => k.intent === "moodboard" || k.intent === "mock"),
    });
    open(file({ stage: "inspiration" }));
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const card = $('[data-direction="poster"]') as HTMLElement;
    await openMenu(button(/^Draw$/, card));
    await settle(10);
    const items = $$("[data-slot='dropdown-menu-item']");
    expect(items.filter((i) => !i.hasAttribute("data-unavailable")).map((i) => text(i))).toEqual([
      expect.stringContaining("Mood board"),
      expect.stringContaining("Page mock"),
    ]);
    const off = items.filter((i) => i.hasAttribute("data-unavailable"));
    expect(off.length).toBeGreaterThan(3);
    expect(off.every((i) => i.hasAttribute("data-disabled"))).toBe(true);
    // A custom image takes its words in the directions step.
    expect(items.some((i) => text(i).includes("Custom image"))).toBe(false);
    await interact(() => press(document.activeElement ?? document.body, "Escape"));
  });

  test("the inspiration step shows the kept directions' images and goes on to mocks or screens", async () => {
    open(
      file({
        stage: "inspiration",
        directions: [
          {
            id: "poster",
            title: "Park poster",
            description: "Screen-printed",
            images: [
              image("moodboard", "poster/board-1.png"),
              { ...image("custom", "poster/custom-1.png"), ask: "the product on a desk" },
            ],
          },
          { id: "quiet", title: "Quiet", description: "Muted", picked: false },
        ],
      }),
    );
    views.push(await mount(<SketchbookView />));
    await settle(10);
    expect($('[data-direction="quiet"]')).toBeNull();
    const card = $('[data-direction="poster"]') as HTMLElement;
    expect(
      [...card.querySelectorAll("[data-kind]")].map((g) => g.getAttribute("data-kind")),
    ).toEqual(["moodboard", "custom"]);
    const again = card.querySelector(
      '[data-kind="custom"] [aria-label="Draw another custom image"]',
    );
    await interact(() => (again as HTMLElement).click());
    expect(draws).toContainEqual({
      kind: "custom",
      directions: ["poster"],
      count: 1,
      ask: "the product on a desk",
    });
    expect(text(button(/^Draw \d+ mocks?/))).toContain("Draw 2 mocks");
    await interact(() => button(/^Skip to screens$/).click());
    expect(updates).toContainEqual({ stage: "screens" });
  });

  test("a screen is designed from the direction alone, and each direction's board opens", async () => {
    open(
      file({
        stage: "screens",
        buildBoards: { poster: "b1" },
        directions: [
          {
            id: "poster",
            title: "Park poster",
            description: "Screen-printed",
            images: [image("moodboard", "poster/board-1.png"), image("palette", "poster/pal.png")],
            proposal: { tokens: { "colors.primary.DEFAULT": "#2f4a3a" }, fonts: [] },
          },
        ],
      }),
    );
    const shown: (string | undefined)[] = [];
    useCanvas.setState({
      boards: { b1: { id: "b1", name: "Trailhead · Park poster" } } as unknown as ReturnType<
        typeof useCanvas.getState
      >["boards"],
      showSketchbookBuild: async (board?: string) => {
        shown.push(board);
      },
    });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    const row = $('section[data-direction="poster"]') as HTMLElement;
    // The direction alone, then the mood board; a palette doesn't design a screen.
    expect(
      [...row.querySelectorAll("[data-choice]")].map((c) => c.getAttribute("data-choice")),
    ).toEqual(["direction", "moodboard"]);
    await interact(() =>
      button(
        /^Design from this$/,
        row.querySelector('[data-choice="direction"]') as HTMLElement,
      ).click(),
    );
    expect(updates).toContainEqual({ chosen: [{ direction: "poster" }] });
    await interact(() => button(/^Open the board/, row).click());
    expect(shown).toEqual(["b1"]);
  });

  test("the rail lists the five stages with where each stands", async () => {
    open(file({ stage: "screens" }));
    views.push(await mount(<SketchbookRail />));
    await settle(10);
    const steps = $$("nav[aria-label='Sketchbook'] button").map((b) => text(b));
    expect(steps).toEqual([
      expect.stringContaining("Brief"),
      "Directions2 picked, tokens 1/3",
      "Inspiration1 drawn",
      "MocksSkipped",
      "ScreensNothing chosen yet",
    ]);
  });
});
