import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Frame as FrameT } from "@velloo/schema";
import { domSuite, interact, mount } from "../../../__tests__/dom.ts";
import { type FakeServer, screenFixture, serveFolder } from "../../../__tests__/fake-server.ts";

/**
 * The double-buffered iframe swap. A src change is a full navigation,
 * and a single iframe blanks white while the new document loads — which is
 * what made every edit flicker. The fix is invisible in markup terms and has
 * no failure mode that shouts: get it wrong and the canvas simply goes back to
 * flashing, or worse, swaps to a buffer that never loaded.
 */

mock.module("../../../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: () => "toast",
}));

const { Frame } = await import("../../Frame.tsx");
const { useCanvas } = await import("../../../store.ts");

const frame: FrameT = { id: "f1", screen: "home", x: 0, y: 0, w: 400, h: 300 } as FrameT;

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

/** A buffer with no src isn't rendered at all, so the count is the state. */
const iframes = (host: HTMLElement) => [...host.querySelectorAll("iframe")];
/** The slot the user is looking at — the hidden back buffer is aria-hidden. */
const front = (host: HTMLElement) =>
  iframes(host).find((f) => f.getAttribute("aria-hidden") !== "true");
const back = (host: HTMLElement) =>
  iframes(host).find((f) => f.getAttribute("aria-hidden") === "true");
const frontSrc = (host: HTMLElement) => front(host)?.getAttribute("src");

async function mountFrame() {
  const view = await mount(
    <Frame boardId="main" frame={frame} frames={[frame]} presets={[]} sharedCount={0} />,
  );
  views.push(view);
  return view;
}

/** The iframe reporting that its document finished loading. */
async function load(el: HTMLIFrameElement): Promise<void> {
  await interact(() => {
    el.dispatchEvent(new window.Event("load"));
  });
}

beforeEach(() => {
  server = serveFolder();
  useCanvas.setState({
    screens: { home: screenFixture("home") },
    boards: {
      main: { id: "main", name: "main", frames: [frame] },
    } as never,
    design: null,
    currentBoardId: "main",
    currentScreenId: "home",
    screenVersion: 0,
    screenVersions: { home: 0 },
    themeVersion: 0,
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

domSuite("double-buffered iframes", () => {
  test("mounts with one document, not two", async () => {
    const { host } = await mountFrame();
    expect(iframes(host)).toHaveLength(1);
    expect(frontSrc(host)).toContain("/api/render/home");
  });

  test("an edit loads into the back buffer while the old render stays painted", async () => {
    const { host } = await mountFrame();
    const before = frontSrc(host);
    await interact(() => useCanvas.setState({ screenVersions: { home: 1 } }));
    // The visible document is untouched — that's the whole point.
    expect(frontSrc(host)).toBe(before as string);
    expect(back(host)?.getAttribute("src")).toBeTruthy();
    expect(back(host)?.getAttribute("src")).not.toBe(before);
  });

  test("the slots swap only once the new document has actually loaded", async () => {
    const { host } = await mountFrame();
    const before = frontSrc(host) as string;
    await interact(() => useCanvas.setState({ screenVersions: { home: 1 } }));
    const pending = back(host)?.getAttribute("src") as string;
    await load(back(host) as HTMLIFrameElement);
    expect(frontSrc(host)).toBe(pending);
    expect(pending).not.toBe(before);
    // The old document is released rather than left resident behind the new one.
    expect(iframes(host)).toHaveLength(1);
  });

  test("editing another screen doesn't reload this frame", async () => {
    const { host } = await mountFrame();
    const before = frontSrc(host);
    await interact(() =>
      useCanvas.setState({ screenVersions: { home: 0, pricing: 3 }, screenVersion: 9 }),
    );
    expect(frontSrc(host)).toBe(before as string);
    expect(iframes(host)).toHaveLength(1);
  });

  test("a second edit before the first lands retargets the same back buffer", async () => {
    const { host } = await mountFrame();
    await interact(() => useCanvas.setState({ screenVersions: { home: 1 } }));
    await interact(() => useCanvas.setState({ screenVersions: { home: 2 } }));
    // One in-flight load, not a queue of them — and it targets the latest edit.
    expect(iframes(host)).toHaveLength(2);
    const pending = back(host)?.getAttribute("src") as string;
    await load(back(host) as HTMLIFrameElement);
    expect(iframes(host)).toHaveLength(1);
    expect(frontSrc(host)).toBe(pending);
  });

  test("a disconnected daemon freezes the src instead of blanking the frame", async () => {
    const { host } = await mountFrame();
    const before = frontSrc(host);
    await interact(() => useCanvas.setState({ wsConnected: false }));
    await interact(() => useCanvas.setState({ themeVersion: 5, screenVersions: { home: 4 } }));
    expect(frontSrc(host)).toBe(before as string);
    expect(iframes(host)).toHaveLength(1);
  });
});

domSuite("pending render", () => {
  test("covers the iframe until its document has painted", async () => {
    const { host } = await mountFrame();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await load(front(host) as HTMLIFrameElement);
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  test("an edit reloads behind the old render rather than back under the loader", async () => {
    const { host } = await mountFrame();
    await load(front(host) as HTMLIFrameElement);
    await interact(() => useCanvas.setState({ screenVersions: { home: 1 } }));
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});

domSuite("measured frame chrome", () => {
  test("reports the chrome inset for annotation anchoring and collision", async () => {
    await mountFrame();
    expect(useCanvas.getState().frameInsets.f1).toBeDefined();
  });

  test("drops the measurement when the frame unmounts", async () => {
    const view = await mountFrame();
    views.pop();
    await view.unmount();
    expect(useCanvas.getState().frameInsets.f1).toBeUndefined();
  });
});
