import { afterEach, beforeEach, expect, test } from "bun:test";
import { $, domSuite, interact, mount, press, settle } from "./dom.ts";

/**
 * Notes on the board, driven the way a person does: a free note deletes from
 * its trash button or the keyboard and resizes only while being edited; an
 * attached note sits on its node as a marker that hover opens and a click
 * keeps open.
 */

const { NotesLayer } = await import("../components/NotesLayer.tsx");
const { useCanvas } = await import("../store.ts");

const realFetch = globalThis.fetch;
let requests: { path: string; body: unknown }[];

const freeNote = { id: "note_f", x: 10, y: 20, width: 240, body: "**Title**\n\nFree words" };
const attachedNote = {
  id: "note_a",
  width: 240,
  body: "Pinned words",
  attachment: { frameId: "fr_home", screenId: "home", locator: "@cta" },
  resolved: [0],
};

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ note: freeNote, removedId: "note_f" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  useCanvas.setState({
    currentBoardId: "main",
    boards: {
      main: {
        id: "main",
        name: "Main",
        frames: [{ id: "fr_home", screen: "home", x: 0, y: 0, w: 600, h: 400 }],
      },
    } as never,
    nodeRects: { fr_home: { "0": { x: 20, y: 30, w: 80, h: 40 } } },
    frameInsets: { fr_home: { x: 0, y: 20, chromeH: 0 } },
    notes: [],
    markupVisible: true,
    editingMarkupId: null,
    canvasZoom: 1,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useCanvas.setState({ notes: [], editingMarkupId: null });
});

const hover = (el: Element): void => {
  el.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
};
const unhover = (el: Element): void => {
  el.dispatchEvent(
    new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
  );
};

domSuite("free notes", () => {
  test("renders the text with no paper behind it, and a trash button that deletes", async () => {
    useCanvas.setState({ notes: [freeNote] });
    const view = await mount(<NotesLayer />);
    const note = $("[data-note-id='note_f']");
    expect(note?.className).not.toContain("bg-amber");
    expect(note?.textContent).toContain("Free words");
    await interact(() => $("[data-note-trash]")?.click());
    expect(requests.map((r) => r.path)).toEqual(["/api/notes/remove"]);
    await view.unmount();
  });

  test("Delete on a selected note removes it; Enter opens the editor with resize handles", async () => {
    useCanvas.setState({ notes: [freeNote] });
    const view = await mount(<NotesLayer />);
    const note = $("[data-note-id='note_f']") as HTMLElement;
    expect($("[data-note-resize]")).toBeNull();
    await interact(() => press(note, "Enter"));
    expect(useCanvas.getState().editingMarkupId).toBe("note_f");
    expect($("textarea[aria-label='Note']")).not.toBeNull();
    expect($("[data-note-resize='xy']")).not.toBeNull();
    expect($("[data-note-trash]")).toBeNull();
    await interact(() => useCanvas.getState().setEditingMarkupId(null));
    await interact(() => press($("[data-note-id='note_f']") as HTMLElement, "Delete"));
    expect(requests.at(-1)?.path).toBe("/api/notes/remove");
    await view.unmount();
  });

  test("a note drawn taller than its text keeps its drawn height as a floor", async () => {
    useCanvas.setState({ notes: [{ ...freeNote, width: 320, height: 180 }] });
    const view = await mount(<NotesLayer />);
    const note = $("[data-note-id='note_f']") as HTMLElement;
    expect(note.style.width).toBe("320px");
    expect(note.style.minHeight).toBe("180px");
    await view.unmount();
  });
});

domSuite("attached notes", () => {
  test("sit on their node as a marker; hover opens them and leaving closes them", async () => {
    useCanvas.setState({ notes: [attachedNote] });
    const view = await mount(<NotesLayer />);
    const wrapper = $("[data-note-attached='true']") as HTMLElement;
    // frame.x + inset.x + rect.x + rect.w, frame.y + inset.y + rect.y
    expect(wrapper.style.left).toBe("100px");
    expect(wrapper.style.top).toBe("50px");
    expect($("[data-note-card]")).toBeNull();
    await interact(() => hover(wrapper));
    expect($("[data-note-card]")?.textContent).toContain("Pinned words");
    await interact(() => unhover(wrapper));
    await settle(250);
    expect($("[data-note-card]")).toBeNull();
    await view.unmount();
  });

  test("a click keeps the note open after the pointer leaves", async () => {
    useCanvas.setState({ notes: [attachedNote] });
    const view = await mount(<NotesLayer />);
    const wrapper = $("[data-note-attached='true']") as HTMLElement;
    await interact(() => ($("[data-note-marker]") as HTMLElement).click());
    await interact(() => unhover(wrapper));
    await settle(250);
    expect($("[data-note-card]")).not.toBeNull();
    await view.unmount();
  });

  test("Delete on the marker removes the note", async () => {
    useCanvas.setState({ notes: [attachedNote] });
    const view = await mount(<NotesLayer />);
    await interact(() => press($("[data-note-marker]") as HTMLElement, "Backspace"));
    expect(requests.map((r) => r.path)).toEqual(["/api/notes/remove"]);
    await view.unmount();
  });
});
