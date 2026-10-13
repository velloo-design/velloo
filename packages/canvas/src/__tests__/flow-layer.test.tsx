import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { FlowEdge } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";

/**
 * The arrows between a board's frames: what they draw from the board's edges,
 * that they keep up with a frame being dragged, and that the chip on each one
 * edits it through the same `connect_frames` write an agent uses.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: (input: { message: string }) => {
    toasts.push(input.message);
    return "toast";
  },
  toastError: (err: unknown, fallback: string) => {
    toasts.push(err instanceof Error ? err.message : fallback);
    return "toast";
  },
}));

const { FlowLayer } = await import("../components/FlowLayer.tsx");
const { FlowHandle } = await import("../components/Frame/FlowHandle.tsx");
const { useCanvas } = await import("../store.ts");

const realFetch = globalThis.fetch;
let requests: { path: string; body: { edges: Array<Record<string, unknown>> } }[];
/** What the daemon answers a write with: the board's arrows afterwards. */
let answer: FlowEdge[];
/** Set to make the next write fail the way the daemon refuses one. */
let refusal: string | null;
/** Arrows the daemon says it kept as transitions, for the next write. */
let kept: Array<{ from: string; to: string; state: string }> | undefined;

const FRAMES = [
  { id: "form", screen: "form", x: 0, y: 0, w: 400, h: 300 },
  { id: "sending", screen: "sending", x: 600, y: 0, w: 400, h: 300 },
  { id: "verify", screen: "verify", x: 1200, y: 0, w: 400, h: 300, label: "Check your inbox" },
];
const loading: FlowEdge = { from: "form", to: "sending", state: "loading", label: "Submit" };
const next: FlowEdge = { from: "sending", to: "verify" };

function seed(edges: FlowEdge[] | undefined): void {
  useCanvas.setState({
    currentBoardId: "signup",
    boards: {
      signup: {
        id: "signup",
        name: "Sign up",
        frames: FRAMES,
        groups: [],
        ...(edges ? { edges } : {}),
      },
    } as never,
    screens: {
      form: { id: "form", name: "Sign up form", tree: { $ref: "Box" } },
      sending: { id: "sending", name: "Sending", tree: { $ref: "Box" } },
    } as never,
    frameInsets: Object.fromEntries(FRAMES.map((f) => [f.id, { x: 0, y: 20, chromeH: 44 }])),
    frameDrafts: {},
    flowDraft: null,
    activeFlowEdge: null,
    markupVisible: true,
    cursorMode: "select",
    wsConnected: true,
    canvasZoom: 1,
  });
}

beforeEach(() => {
  requests = [];
  answer = [];
  refusal = null;
  kept = undefined;
  toasts.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (refusal !== null) {
      return new Response(JSON.stringify({ error: { kind: "BadRequest", message: refusal } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const body = { edges: answer, ...(kept ? { readAsTransitions: kept } : {}) };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useCanvas.setState({ activeFlowEdge: null, flowDraft: null, frameDrafts: {} });
});

const lineOf = (key: string): string =>
  $(`[data-flow-edge="${key}"] path`)?.getAttribute("d") ?? "";

domSuite("flow arrows", () => {
  test("a board with no arrows draws nothing", async () => {
    seed(undefined);
    const view = await mount(<FlowLayer />);
    expect($("[data-flow-layer]")).toBeNull();
    await view.unmount();
  });

  test("draws one arrow per edge, from the rendered screen's edge, with its chip", async () => {
    seed([loading, next]);
    const view = await mount(<FlowLayer />);
    expect($$("[data-flow-edge]").map((g) => g.getAttribute("data-flow-edge"))).toEqual([
      "form→sending",
      "sending→verify",
    ]);
    // The header row sits above the screen: the arrow leaves at mid-height of
    // the iframe (20 + 300 / 2), not of the frame's origin box.
    expect(lineOf("form→sending").startsWith("M 400 170 C ")).toBe(true);
    expect(lineOf("form→sending").endsWith(", 600 170")).toBe(true);

    expect($('[data-flow-edge="form→sending"]')?.getAttribute("data-flow-state")).toBe("loading");
    expect(text($('[data-flow-chip="form→sending"]'))).toBe("loadingSubmit");
    // A transition with nothing to say is still clickable: a bare dot.
    expect(text($('[data-flow-chip="sending→verify"]'))).toBe("");
    expect($('[data-flow-chip="sending→verify"]')?.getAttribute("aria-label")).toBe(
      "Arrow from Sending to Check your inbox",
    );
    await view.unmount();
  });

  test("a state arrow is dashed and tinted; a transition is neither", async () => {
    seed([{ from: "form", to: "sending", state: "error" }, next]);
    const view = await mount(<FlowLayer />);
    const state = $('[data-flow-edge="form→sending"]');
    const plain = $('[data-flow-edge="sending→verify"]');
    expect(state?.getAttribute("class")).toContain("text-destructive");
    expect(state?.querySelector("path")?.getAttribute("style")).toContain("stroke-dasharray");
    expect(plain?.querySelector("path")?.getAttribute("style")).not.toContain("stroke-dasharray");
    await view.unmount();
  });

  test("stroke weight and chip size are held constant by the zoom variable", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    expect($('[data-flow-edge="form→sending"] path')?.getAttribute("style")).toContain(
      "calc(1.5px / var(--canvas-zoom, 1))",
    );
    expect($('[data-flow-chip="form→sending"]')?.parentElement?.getAttribute("style")).toContain(
      "scale(calc(1 / var(--canvas-zoom, 1)))",
    );
    await view.unmount();
  });

  test("a labelled chip sits beside its arrow; a bare dot sits on it", async () => {
    seed([loading, next, { from: "verify", to: "sending", label: "Back" }]);
    const view = await mount(<FlowLayer />);
    const placed = (key: string) =>
      $(`[data-flow-chip="${key}"]`)?.parentElement?.getAttribute("style") ?? "";
    // Above a level arrow, so a short arrow's head is never under its label.
    expect(placed("form→sending")).toContain("translate(0, calc(-50% - 7px))");
    // A pair running both ways part: the one going back takes the lower side.
    expect(placed("verify→sending")).toContain("translate(0, calc(50% + 7px))");
    expect(placed("sending→verify")).not.toContain("calc(-50% - 7px)");
    await view.unmount();
  });

  test("an arrow from above stops short of the header, by more as the board zooms out", async () => {
    seed([{ from: "form", to: "below" }]);
    const board = useCanvas.getState().boards.signup;
    useCanvas.setState({
      boards: {
        signup: {
          ...board,
          frames: [...FRAMES, { id: "below", screen: "form", x: 0, y: 600, w: 400, h: 300 }],
        },
      } as never,
      frameInsets: { ...useCanvas.getState().frameInsets, below: { x: 0, y: 20, chromeH: 44 } },
    });
    const view = await mount(<FlowLayer />);
    // Screen top is 620; the 20px header row covers 20 board px at 100%…
    expect(lineOf("form→below").endsWith(", 200 600")).toBe(true);
    // …and 80 at 25%, where it is still 20px tall on screen.
    await interact(() => useCanvas.setState({ canvasZoom: 0.25 }));
    expect(lineOf("form→below").endsWith(", 200 540")).toBe(true);
    await view.unmount();
  });

  test("an arrow to a frame that is gone is skipped, not drawn to nowhere", async () => {
    seed([loading, { from: "form", to: "deleted" }]);
    const view = await mount(<FlowLayer />);
    expect($$("[data-flow-edge]")).toHaveLength(1);
    await view.unmount();
  });

  test("arrows follow a frame while it is being dragged", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() =>
      useCanvas.getState().setFrameDraft("sending", { x: 600, y: 400, w: 400, h: 300 }),
    );
    expect(lineOf("form→sending").endsWith(", 600 570")).toBe(true);
    await interact(() => useCanvas.getState().setFrameDraft("sending", null));
    expect(lineOf("form→sending").endsWith(", 600 170")).toBe(true);
    await view.unmount();
  });

  test("hides with the rest of the markup", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => useCanvas.setState({ markupVisible: false }));
    expect($("[data-flow-layer]")).toBeNull();
    expect($("[data-flow-chip]")).toBeNull();
    await view.unmount();
  });

  test("an arrow being dragged out shows where it would land", async () => {
    seed([]);
    const view = await mount(<FlowLayer />);
    await interact(() => useCanvas.getState().setFlowDraft({ from: "form", x: 500, y: 100 }));
    expect($("[data-flow-layer]")).not.toBeNull();
    expect($("[data-flow-drop-target]")).toBeNull();
    await interact(() => useCanvas.getState().setFlowDraft({ from: "form", x: 700, y: 100 }));
    expect($("[data-flow-drop-target]")?.getAttribute("data-flow-drop-target")).toBe("sending");
    // Never back onto the frame it started from.
    await interact(() => useCanvas.getState().setFlowDraft({ from: "form", x: 200, y: 100 }));
    expect($("[data-flow-drop-target]")).toBeNull();
    await view.unmount();
  });
});

domSuite("editing an arrow", () => {
  test("the chip opens an editor that names both frames", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    expect(useCanvas.getState().activeFlowEdge).toEqual({ from: "form", to: "sending" });
    expect(text($("[data-slot='popover-title']"))).toBe("Sign up form → Sending");
    expect(text($("[data-slot='field-description']"))).toContain("in its loading state");
    await view.unmount();
  });

  test("clicking the arrow itself opens the same editor as its chip", async () => {
    seed([next]);
    const view = await mount(<FlowLayer />);
    // The second path of the stroke pair is the head; the third is the wide
    // invisible stroke that takes the click.
    const hit = $$('[data-flow-edge="sending→verify"] path').at(-1);
    expect(hit?.getAttribute("stroke")).toBe("transparent");
    await interact(() => {
      hit?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(useCanvas.getState().activeFlowEdge).toEqual({ from: "sending", to: "verify" });
    expect($("[data-slot='popover-content']")).not.toBeNull();
    await view.unmount();
  });

  test("a write the daemon refuses says why and leaves the board as it was", async () => {
    seed([next]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="sending→verify"]')?.click());
    refusal = 'Can\'t draw that flow: "verify" is already the error state of "form".';
    await interact(() => $('[data-flow-state-option="error"]')?.click());
    await settle();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toContain("already the error state");
    expect(useCanvas.getState().boards.signup?.edges).toEqual([next]);
    // The editor stays open on the arrow that was not changed.
    expect(useCanvas.getState().activeFlowEdge).toEqual({ from: "sending", to: "verify" });
    await view.unmount();
  });

  test("a state the target already has in this step is kept as a transition, and says so", async () => {
    seed([loading, { from: "verify", to: "sending" }]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="verify→sending"]')?.click());
    answer = [loading, { from: "verify", to: "sending" }];
    kept = [{ from: "verify", to: "sending", state: "loading" }];
    await interact(() => $('[data-flow-state-option="loading"]')?.click());
    await settle();
    expect(toasts).toEqual([
      "That frame is already the loading state of this step, so the arrow stays a transition into it.",
    ]);
    expect($('[data-flow-edge="verify→sending"]')?.getAttribute("data-flow-state")).toBe("");
    await view.unmount();
  });

  test("a label changed from elsewhere replaces what the open editor shows", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    const board = useCanvas.getState().boards.signup;
    await interact(() =>
      useCanvas.setState({
        boards: { signup: { ...board, edges: [{ ...loading, label: "Send" }] } } as never,
      }),
    );
    expect(($("[data-slot='popover-content'] input") as HTMLInputElement).value).toBe("Send");
    await view.unmount();
  });

  test("with no board open there is nothing to write to", async () => {
    seed([next]);
    useCanvas.setState({ currentBoardId: null });
    expect(
      await useCanvas.getState().connectFrames([{ from: "sending", to: "verify" }]),
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  test("picking a state writes it; picking it again makes the arrow a transition", async () => {
    seed([next]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="sending→verify"]')?.click());

    answer = [{ ...next, state: "error" }];
    await interact(() => $('[data-flow-state-option="error"]')?.click());
    await settle();
    expect(requests.at(-1)).toEqual({
      path: "/api/mutate/connect_frames",
      body: {
        boardId: "signup",
        edges: [{ from: "sending", to: "verify", state: "error" }],
      } as never,
    });
    // The server's answer is the board's arrows now — no wait for the watcher.
    expect(useCanvas.getState().boards.signup?.edges).toEqual(answer);

    answer = [next];
    await interact(() => $('[data-flow-state-option="error"]')?.click());
    await settle();
    expect(requests.at(-1)?.body.edges).toEqual([{ from: "sending", to: "verify", state: null }]);
    await view.unmount();
  });

  test("a state an agent invented is offered alongside the usual four", async () => {
    seed([{ from: "form", to: "sending", state: "offline" }]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    expect($$("[data-flow-state-option]").map((el) => text(el))).toEqual([
      "loading",
      "empty",
      "error",
      "success",
      "offline",
    ]);
    await view.unmount();
  });

  test("Enter saves the label and closes; an unchanged label writes nothing", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    const input = $("[data-slot='popover-content'] input") as HTMLInputElement;
    expect(input.value).toBe("Submit");

    answer = [{ ...loading, label: "Create account" }];
    await interact(() => typeInto(input, "  Create account "));
    await interact(() => press(input, "Enter"));
    await settle();
    expect(requests.map((r) => r.body.edges)).toEqual([
      [{ from: "form", to: "sending", label: "Create account" }],
    ]);
    expect(useCanvas.getState().activeFlowEdge).toBeNull();
    await view.unmount();
  });

  test("clearing the label sends null, not an empty string", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    const input = $("[data-slot='popover-content'] input") as HTMLInputElement;
    answer = [{ from: "form", to: "sending", state: "loading" }];
    await interact(() => typeInto(input, ""));
    await interact(() => press(input, "Enter"));
    await settle();
    expect(requests.at(-1)?.body.edges).toEqual([{ from: "form", to: "sending", label: null }]);
    await view.unmount();
  });

  test("Remove erases the arrow and closes its editor", async () => {
    seed([loading]);
    const view = await mount(<FlowLayer />);
    await interact(() => $('[data-flow-chip="form→sending"]')?.click());
    const remove = $$("[data-slot='popover-content'] button").find((b) =>
      text(b).includes("Remove arrow"),
    );
    answer = [];
    await interact(() => remove?.click());
    await settle();
    expect(requests.at(-1)?.body.edges).toEqual([{ from: "form", to: "sending", remove: true }]);
    expect(useCanvas.getState().boards.signup).not.toHaveProperty("edges");
    expect(useCanvas.getState().activeFlowEdge).toBeNull();
    expect($("[data-flow-edge]")).toBeNull();
    await view.unmount();
  });
});

/** A raw pointer event, as the browser would deliver it to the captured handle. */
function pointer(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  target.dispatchEvent(event);
}

/** The handle inside a board world, which is what it measures the pointer against. */
async function mountHandle(frame: string) {
  const view = await mount(
    <div data-velloo-board-world="true">
      <FlowHandle frameId={frame} />
    </div>,
  );
  const handle = $(`[data-flow-handle="${frame}"]`) as HTMLElement;
  // happy-dom has no pointer capture; the handle only needs the call to succeed.
  handle.setPointerCapture ??= () => undefined;
  return { view, handle };
}

domSuite("the connect handle", () => {
  test("dragging it onto another frame draws the arrow and opens its editor", async () => {
    seed([]);
    const { view, handle } = await mountHandle("form");
    await interact(() => pointer(handle, "pointerdown", 400, 170));
    expect(useCanvas.getState().flowDraft).toEqual({ from: "form", x: 400, y: 170 });
    await interact(() => pointer(handle, "pointermove", 700, 100));
    expect(useCanvas.getState().flowDraft).toEqual({ from: "form", x: 700, y: 100 });

    answer = [{ from: "form", to: "sending" }];
    await interact(() => pointer(handle, "pointerup", 700, 100));
    await settle();
    expect(requests).toEqual([
      {
        path: "/api/mutate/connect_frames",
        body: { boardId: "signup", edges: [{ from: "form", to: "sending" }] } as never,
      },
    ]);
    expect(useCanvas.getState().flowDraft).toBeNull();
    expect(useCanvas.getState().activeFlowEdge).toEqual({ from: "form", to: "sending" });
    await view.unmount();
  });

  test("the pointer is read in board space, whatever the zoom", async () => {
    seed([]);
    useCanvas.setState({ canvasZoom: 0.5 });
    const { view, handle } = await mountHandle("form");
    await interact(() => pointer(handle, "pointerdown", 200, 85));
    expect(useCanvas.getState().flowDraft).toEqual({ from: "form", x: 400, y: 170 });
    answer = [{ from: "form", to: "sending" }];
    // Screen (350, 50) is board (700, 100): inside "sending".
    await interact(() => pointer(handle, "pointerup", 350, 50));
    await settle();
    expect(requests.at(-1)?.body.edges).toEqual([{ from: "form", to: "sending" }]);
    await view.unmount();
  });

  test("dropping it on empty board, or back on its own frame, draws nothing", async () => {
    seed([]);
    const { view, handle } = await mountHandle("form");
    await interact(() => pointer(handle, "pointerdown", 400, 170));
    await interact(() => pointer(handle, "pointerup", 500, 800));
    await interact(() => pointer(handle, "pointerdown", 400, 170));
    await interact(() => pointer(handle, "pointerup", 200, 100));
    await settle();
    expect(requests).toEqual([]);
    expect(useCanvas.getState().flowDraft).toBeNull();
    await view.unmount();
  });

  test("dropping it on a frame it already points at edits that arrow instead", async () => {
    seed([loading]);
    const { view, handle } = await mountHandle("form");
    await interact(() => pointer(handle, "pointerdown", 400, 170));
    await interact(() => pointer(handle, "pointerup", 700, 100));
    await settle();
    expect(requests).toEqual([]);
    expect(useCanvas.getState().activeFlowEdge).toEqual({ from: "form", to: "sending" });
    await view.unmount();
  });

  test("a cancelled drag leaves no draft behind", async () => {
    seed([]);
    const { view, handle } = await mountHandle("form");
    await interact(() => pointer(handle, "pointerdown", 400, 170));
    await interact(() => pointer(handle, "pointercancel", 700, 100));
    expect(useCanvas.getState().flowDraft).toBeNull();
    await interact(() => pointer(handle, "pointerup", 700, 100));
    await settle();
    expect(requests).toEqual([]);
    await view.unmount();
  });

  test("shows in select mode with markup on, and nowhere else", async () => {
    seed([]);
    const view = await mount(<FlowHandle frameId="form" />);
    expect($('[data-flow-handle="form"]')).not.toBeNull();
    await interact(() => useCanvas.setState({ cursorMode: "hand" }));
    expect($("[data-flow-handle]")).toBeNull();
    await interact(() => useCanvas.setState({ cursorMode: "select", markupVisible: false }));
    expect($("[data-flow-handle]")).toBeNull();
    await view.unmount();
  });
});
