import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Frame as FrameT } from "@velloo/schema";
import type { PointerEvent as ReactPointerEvent } from "react";
import { domSuite, interact, mount } from "../../../__tests__/dom.ts";
import { type FakeServer, serveFolder } from "../../../__tests__/fake-server.ts";

/**
 * Moving and resizing a frame. The collision maths has its own suite; what was
 * untested is the wiring around it — that a gesture is measured in board units
 * rather than screen pixels, that the axis a handle owns is the only one it
 * changes, that a gesture which ends where it started writes nothing, and that
 * the pointer listeners come off again. All of it is behaviour under the
 * pointer, invisible to any markup assertion.
 */

const toasts: string[] = [];
mock.module("../../../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const { useFrameInteractions } = await import("../useFrameInteractions.ts");
const { useCanvas } = await import("../../../store.ts");
const { MIN_FRAME_SIDE } = await import("../collision.ts");

type Interactions = ReturnType<typeof useFrameInteractions>;

const frameAt = (over: Partial<FrameT> = {}): FrameT =>
  ({ id: "f1", screen: "home", x: 0, y: 0, w: 400, h: 300, ...over }) as FrameT;

function Harness(props: {
  frame: FrameT;
  otherFrames: FrameT[];
  sink: (api: Interactions) => void;
}) {
  props.sink(
    useFrameInteractions({
      boardId: "main",
      frame: props.frame,
      otherFrames: props.otherFrames,
    }),
  );
  return <div data-grip="1" />;
}

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

async function gesture(frame: FrameT = frameAt(), otherFrames: FrameT[] = []) {
  let latest: Interactions | null = null;
  const view = await mount(
    <Harness
      frame={frame}
      otherFrames={otherFrames}
      sink={(api) => {
        latest = api;
      }}
    />,
  );
  views.push(view);
  const grip = view.host.querySelector("[data-grip]") as HTMLElement;
  // happy-dom has no pointer capture; the hook only needs the call to succeed.
  grip.setPointerCapture ??= () => undefined;
  return { grip, api: () => latest as unknown as Interactions };
}

/** The commit is fired and forgotten — let it reach the server before asserting. */
const committed = () => Bun.sleep(5);

/** The React synthetic event the hook's handlers are given. */
const start = (target: HTMLElement, x: number, y: number, button = 0) =>
  ({
    currentTarget: target,
    clientX: x,
    clientY: y,
    button,
    pointerId: 1,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
  }) as unknown as ReactPointerEvent<HTMLDivElement>;

/** A raw pointer event on the captured target, as the window would deliver. */
function pointer(target: HTMLElement, type: string, x: number, y: number): void {
  const event = new window.Event(type, { bubbles: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
  target.dispatchEvent(event);
}

type UpdateFrameArgs = {
  boardId: string;
  patches: { frameId: string; patch: Record<string, number> }[];
};

const lastCommit = () => server.mutations.at(-1)?.args as UpdateFrameArgs | undefined;
const lastPatch = () => lastCommit()?.patches[0]?.patch;

beforeEach(() => {
  toasts.length = 0;
  server = serveFolder();
  useCanvas.setState({ canvasZoom: 1, frameInsets: {} });
});

afterEach(async () => {
  // Unmount while the DOM is still registered: React settles its scheduled
  // work here rather than after dom.ts tears the globals down.
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("resize", () => {
  test("a corner handle moves both axes", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 60, 40));
    expect(api().draftSize).toEqual({ w: 460, h: 340 });
  });

  test("an edge handle owns one axis and leaves the other alone", async () => {
    const east = await gesture();
    await interact(() => east.api().startResize("e")(start(east.grip, 0, 0)));
    await interact(() => pointer(east.grip, "pointermove", 60, 40));
    expect(east.api().draftSize).toEqual({ w: 460, h: 300 });

    const south = await gesture();
    await interact(() => south.api().startResize("s")(start(south.grip, 0, 0)));
    await interact(() => pointer(south.grip, "pointermove", 60, 40));
    expect(south.api().draftSize).toEqual({ w: 400, h: 340 });
  });

  test("the drag is measured in board units, not screen pixels", async () => {
    useCanvas.setState({ canvasZoom: 0.5 });
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 100, 0));
    // 100 screen px at half zoom is 200 board px.
    expect(api().draftSize?.w).toBe(600);
  });

  test("a frame can't be dragged smaller than a frame", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", -10_000, -10_000));
    expect(api().draftSize).toEqual({ w: MIN_FRAME_SIDE, h: MIN_FRAME_SIDE });
  });

  test("growth stops flush against a neighbour, chrome included", async () => {
    useCanvas.setState({ frameInsets: { f2: { x: 0, y: 40, chromeH: 60 } } });
    const neighbour = frameAt({ id: "f2", x: 500, y: 0 });
    const { grip, api } = await gesture(frameAt(), [neighbour]);
    await interact(() => api().startResize("e")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 1000, 0));
    expect(api().draftSize?.w).toBe(500);
  });

  test("an unmeasured frame falls back to the default chrome allowance", async () => {
    // No frameInsets: the neighbour below occupies h + 44, so growing south
    // stops at its top edge either way — what's asserted is that the fallback
    // is used rather than the gesture throwing on a missing measurement.
    const { grip, api } = await gesture(frameAt(), [frameAt({ id: "f2", x: 0, y: 400 })]);
    await interact(() => api().startResize("s")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 0, 1000));
    expect(api().draftSize?.h).toBe(400 - 44);
  });

  test("the new size is committed on release, and the draft cleared", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 60, 40));
    await interact(() => pointer(grip, "pointerup", 60, 40));
    await committed();
    expect(server.mutations.at(-1)?.op).toBe("update_frame");
    expect(lastCommit()).toEqual({
      boardId: "main",
      patches: [{ frameId: "f1", patch: { w: 460, h: 340 } }],
    });
    expect(api().draftSize).toBeNull();
  });

  test("a gesture that ends where it started writes nothing", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 40, 40));
    await interact(() => pointer(grip, "pointerup", 0, 0));
    await committed();
    expect(server.mutations).toEqual([]);
    expect(api().draftSize).toBeNull();
  });

  test("a cancelled pointer ends the gesture like a release", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointercancel", 60, 40));
    await committed();
    expect(lastPatch()).toEqual({ w: 460, h: 340 });
    expect(api().draftSize).toBeNull();
  });

  test("the listeners come off, so a later pointer move is not a resize", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointerup", 60, 40));
    await interact(() => pointer(grip, "pointermove", 999, 999));
    await committed();
    expect(api().draftSize).toBeNull();
    expect(server.mutations).toHaveLength(1);
  });

  test("a rejected resize is reported rather than silently reverted", async () => {
    server.fail("/api/mutate/", 409);
    const { grip, api } = await gesture();
    await interact(() => api().startResize("se")(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointerup", 60, 40));
    await Bun.sleep(10);
    expect(toasts).toEqual(["Could not resize frame"]);
  });
});

domSuite("move", () => {
  test("the frame follows the pointer in board units", async () => {
    useCanvas.setState({ canvasZoom: 2 });
    const { grip, api } = await gesture(frameAt({ x: 100, y: 100 }));
    await interact(() => api().startDrag(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 100, 50));
    expect(api().draftPos).toEqual({ x: 150, y: 125 });
  });

  test("a drop lands flush against a neighbour instead of over it", async () => {
    const neighbour = frameAt({ id: "f2", x: 500, y: 0 });
    const { grip, api } = await gesture(frameAt(), [neighbour]);
    await interact(() => api().startDrag(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointermove", 440, 0));
    // The drop overlaps; the dragged frame — never the neighbour — is pushed
    // back until its right edge sits flush against the neighbour's left.
    expect(api().draftPos).toEqual({ x: 100, y: 0 });
  });

  test("the new position is committed on release", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startDrag(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointerup", 30, 70));
    await committed();
    expect(lastPatch()).toEqual({ x: 30, y: 70 });
    expect(api().draftPos).toBeNull();
  });

  test("only the primary button drags — right-click belongs to the menu", async () => {
    const { grip, api } = await gesture();
    await interact(() => api().startDrag(start(grip, 0, 0, 2)));
    await interact(() => pointer(grip, "pointermove", 100, 100));
    await committed();
    expect(api().draftPos).toBeNull();
    expect(server.mutations).toEqual([]);
  });

  test("a rejected move is reported", async () => {
    server.fail("/api/mutate/", 409);
    const { grip, api } = await gesture();
    await interact(() => api().startDrag(start(grip, 0, 0)));
    await interact(() => pointer(grip, "pointerup", 30, 70));
    await Bun.sleep(10);
    expect(toasts).toEqual(["Could not move frame"]);
  });
});
