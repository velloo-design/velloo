import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ReferencePatch, SketchbookSummary, UpdateSketchbookBody } from "@velloo/protocol";
import type { SketchbookSubject } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";

/**
 * The ways into a sketchbook: the home (no sketchbook open), each flow's
 * start page, and the Agent tab's one Sketchbook entry.
 */

mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));
mock.module("../api/sketchbook.ts", () => ({
  sketchbook: { pages: async () => ({ pages: [], hasApp: true }) },
  proposalSpecimenSrc: () => "",
}));

const { SketchbookView } = await import("../components/Sketchbook/SketchbookView.tsx");
const { SketchbookNudge } = await import("../components/Sketchbook/SketchbookNudge.tsx");
const { useCanvas } = await import("../store.ts");

const book = (over: Partial<SketchbookSummary>): SketchbookSummary => ({
  id: "sb",
  name: "Sketchbook",
  subject: "page",
  stage: "brief",
  agentSession: null,
  buildBoard: null,
  directions: 0,
  images: 0,
  ...over,
});

const views: { unmount(): Promise<void> }[] = [];
let opened: (string | null)[];
let started: SketchbookSubject[];
let begun: {
  body: Pick<UpdateSketchbookBody, "origin" | "page" | "subject">;
  text: string;
  references: ReferencePatch[] | undefined;
}[];

beforeEach(() => {
  opened = [];
  started = [];
  begun = [];
  useCanvas.setState({
    view: "sketchbook",
    sketchbookId: null,
    sketchbook: null,
    sketchbookStart: null,
    sketchbooks: [
      book({ id: "old", name: "Pricing calm", stage: "mocks", updatedAt: "2026-11-01T10:00:00Z" }),
      book({
        id: "new",
        name: "Night market",
        subject: "look",
        stage: "directions",
        agentSession: "s1",
        updatedAt: "2026-11-14T10:00:00Z",
      }),
    ],
    agentProviders: [{ id: "codex", label: "Codex", status: "ready" } as never],
    agentSessions: [{ id: "s1", provider: "codex", state: "idle" } as never],
    agentActiveSessionId: null,
    looks: [],
    wsConnected: true,
    openSketchbook: async (id?: string | null) => {
      opened.push(id ?? null);
    },
    startSketchbook: async (subject: SketchbookSubject) => {
      started.push(subject);
      useCanvas.setState({ sketchbookStart: subject });
    },
    beginSketchbook: async (body, text, _start, references) => {
      begun.push({ body, text, references });
    },
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

domSuite("sketchbook entry points", () => {
  test("the home asks which flow, then lists the sketchbooks newest first with their stage", async () => {
    views.push(await mount(<SketchbookView />));
    await settle(10);
    expect(
      $$("[data-sketchbook-flow]").map((el) => el.getAttribute("data-sketchbook-flow")),
    ).toEqual(["page", "look"]);
    const rows = $$("[data-sketchbook-item]");
    expect(rows.map((r) => r.getAttribute("data-sketchbook-item"))).toEqual(["new", "old"]);
    expect(text(rows[0] ?? null)).toContain("Explore palettes & type · Directions");
    expect(text(rows[1] ?? null)).toContain("Find a look · Mocks");
    // Only the one whose Agent-tab session is up says so.
    expect(rows[0]?.querySelector("[data-sketchbook-running]")).not.toBeNull();
    expect(rows[1]?.querySelector("[data-sketchbook-running]")).toBeNull();
    await interact(() => rows[1]?.click());
    expect(opened).toEqual(["old"]);
    await interact(() => ($('[data-sketchbook-flow="look"]') as HTMLElement).click());
    expect(started).toEqual(["look"]);
  });

  test("a look's start page takes the goal and references, and starts only once an agent is picked", async () => {
    useCanvas.setState({ sketchbookStart: "look" });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    expect($('[data-sketchbook-start="look"]')).not.toBeNull();
    // A look has no page to pick.
    expect($("#sketchbook-page")).toBeNull();
    await interact(() =>
      typeInto($("#sketchbook-goal") as HTMLTextAreaElement, "Warm and editorial"),
    );
    const address = $('input[aria-label="A page\'s address"]') as HTMLInputElement;
    await interact(() => typeInto(address, "linear.app"));
    await interact(() =>
      ($$("button").find((b) => text(b).trim() === "Add page") as HTMLElement).click(),
    );
    await settle(10);
    expect($$("[data-draft-reference]")).toHaveLength(1);
    expect(begun).toEqual([]);
    await interact(() => ($('[data-agent-choice="codex"]') as HTMLElement).click());
    await settle(10);
    expect(begun).toEqual([
      {
        body: { subject: "look", origin: "existing", page: null },
        text: "Start a Velloo sketchbook exploring palettes and type for this app. What I want: Warm and editorial",
        references: [{ url: "https://linear.app" }],
      },
    ]);
  });

  test("a page's start page picks the page, and goes back to the home", async () => {
    useCanvas.setState({ sketchbookStart: "page" });
    views.push(await mount(<SketchbookView />));
    await settle(10);
    expect($("#sketchbook-page")).not.toBeNull();
    await interact(() =>
      ($$("button").find((b) => text(b).trim() === "Sketchbook") as HTMLElement).click(),
    );
    expect(opened).toEqual([null]);
  });

  test("the Agent tab offers one Sketchbook entry with its two flows beneath it", async () => {
    useCanvas.setState({ view: "boards" });
    views.push(await mount(<SketchbookNudge />));
    await settle(10);
    const entry = $('[data-sketchbook-nudge="sketchbook"]') as HTMLElement;
    expect(text(entry)).toContain("Sketchbook");
    expect([...entry.querySelectorAll("[data-sketchbook-flow]")].map((el) => text(el))).toEqual([
      expect.stringContaining("Find a look"),
      expect.stringContaining("Explore palettes & type"),
    ]);
    await interact(() =>
      (entry.querySelector('[data-sketchbook-flow="page"]') as HTMLElement).click(),
    );
    expect(started).toEqual(["page"]);
  });
});
