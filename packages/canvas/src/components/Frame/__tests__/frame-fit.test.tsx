import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Frame as FrameT, ViewportPreset } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text } from "../../../__tests__/dom.ts";
import { type FakeServer, screenFixture, serveFolder } from "../../../__tests__/fake-server.ts";

/**
 * A frame whose height follows its screen. The daemon does the measuring; what
 * the canvas owes it is not to undo the arrangement by accident. A viewport
 * preset is a width and a height, and a height someone chose is exactly what
 * ends following — so on such a frame a preset may only change the width.
 */

mock.module("../../../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { Frame } = await import("../../Frame.tsx");
const { useCanvas } = await import("../../../store.ts");
const { setApiConnected } = await import("../../../api/connection.ts");

const presets: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Desktop", w: 1440, h: 900 },
];

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

async function place(over: Partial<FrameT>): Promise<void> {
  const frame = { id: "f1", screen: "home", x: 0, y: 0, w: 1440, h: 2310, ...over } as FrameT;
  useCanvas.setState({
    boards: { main: { id: "main", name: "main", frames: [frame] } } as never,
  });
  views.push(
    await mount(
      <Frame boardId="main" frame={frame} frames={[frame]} presets={presets} sharedCount={0} />,
    ),
  );
}

const preset = (name: string) =>
  $$("button").find((el) => el.getAttribute("title")?.startsWith(`${name}:`)) as HTMLButtonElement;

async function pick(name: string): Promise<void> {
  await interact(() => preset(name).click());
  await settle();
}

/** Open the frame's menu and choose the item with this accessible name. */
async function choose(label: string): Promise<void> {
  await interact(() => {
    const trigger = $('button[title="Frame actions"]') as HTMLElement;
    trigger.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
    trigger.click();
  });
  await settle();
  const item = $$('[role="menuitem"]').find((el) => el.getAttribute("aria-label") === label);
  if (!item) {
    throw new Error(`no "${label}" in the frame menu: ${$$('[role="menuitem"]').map(text)}`);
  }
  await interact(() => item.click());
  await settle();
}

const patches = () =>
  server.mutations.map(({ op, args }) => {
    expect(op).toBe("update_frame");
    return (args as { patches: { frameId: string; patch: unknown }[] }).patches;
  });

beforeEach(() => {
  setApiConnected(true);
  server = serveFolder();
  useCanvas.setState({
    screens: { home: screenFixture("home") },
    design: null,
    currentBoardId: "main",
    currentScreenId: "home",
    screenVersion: 0,
    screenVersions: { home: 0 },
    themeVersion: 0,
    canvasZoom: 1,
    wsConnected: true,
    selection: null,
    hover: null,
    reveal: null,
    commentThreads: [],
    notes: [],
    annotations: [],
    frameInsets: {},
    nodeRects: {},
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("viewport presets on a frame that follows its screen", () => {
  test("a preset changes the width and the frame keeps following", async () => {
    await place({ fit: "content" });
    await pick("Mobile");
    // No height: the preset's 844 would be a height someone chose.
    expect(patches()).toEqual([[{ frameId: "f1", patch: { w: 390, fit: "content" } }]]);
  });

  test("the preset whose width it already has writes nothing, whatever its height", async () => {
    await place({ fit: "content" });
    await pick("Desktop");
    expect(server.mutations).toEqual([]);
  });

  test("a frame with a height of its own takes the preset whole", async () => {
    await place({});
    await pick("Mobile");
    expect(patches()).toEqual([[{ frameId: "f1", patch: { w: 390, h: 844 } }]]);
  });

  test("and at the preset's width it still takes the preset's height", async () => {
    await place({});
    await pick("Desktop");
    expect(patches()).toEqual([[{ frameId: "f1", patch: { w: 1440, h: 900 } }]]);
  });
});

domSuite("fitting a frame's height to its content", () => {
  test("switching it on asks the daemon to follow the screen", async () => {
    await place({});
    await choose("Fit height to content");
    expect(patches()).toEqual([[{ frameId: "f1", patch: { fit: "content" } }]]);
  });

  test("switching it off leaves the height where it is, as one somebody chose", async () => {
    await place({ fit: "content" });
    await choose("Stop fitting height to content");
    expect(patches()).toEqual([[{ frameId: "f1", patch: { fit: null } }]]);
  });
});
