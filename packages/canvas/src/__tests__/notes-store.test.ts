import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useCanvas } from "../store.ts";

const realFetch = globalThis.fetch;
let requests: { path: string; body: unknown }[];

const note = { id: "note_1", width: 240, body: "" };

beforeEach(() => {
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    return new Response(JSON.stringify({ note: { ...note, ...(body as object) } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  useCanvas.setState({
    currentBoardId: "main",
    notes: [],
    markupVisible: true,
    editingMarkupId: null,
    cursorMode: "note",
    // At 1:1 opening an editor needs no camera flight, which wants a DOM.
    canvasZoom: 1,
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useCanvas.setState({ notes: [], editingMarkupId: null, cursorMode: "select" });
});

describe("createNote", () => {
  const draft = () => useCanvas.getState().notes[0];

  test("a free note opens as a local draft — nothing is written until it says something", () => {
    useCanvas.getState().createNote({ x: 40, y: 80 });
    expect(requests).toHaveLength(0);
    expect(draft()).toMatchObject({ x: 40, y: 80, width: 240, body: "" });
    expect(useCanvas.getState().editingMarkupId).toBe(draft()?.id ?? null);
  });

  test("a dragged-out note keeps the size it was drawn at", () => {
    useCanvas.getState().createNote({ x: 0, y: 0, width: 360, height: 140 });
    expect(draft()).toMatchObject({ width: 360, height: 140 });
  });

  test("saving the draft writes it once, with its body, size and placement", async () => {
    useCanvas.getState().createNote({ x: 40, y: 80, width: 300, height: 90 });
    const id = draft()?.id as string;
    await useCanvas.getState().saveDraftNote(id, { body: "Hello" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/api/notes/add");
    expect(requests[0]?.body).toMatchObject({
      boardId: "main",
      x: 40,
      y: 80,
      width: 300,
      height: 90,
      body: "Hello",
    });
    expect(useCanvas.getState().notes.map((n) => n.id)).toEqual(["note_1"]);
  });

  test("an attached draft posts its anchor instead of coordinates", async () => {
    const attachment = { frameId: "fr_home", screenId: "home", locator: "@cta" };
    useCanvas.getState().createNote({ attachment, resolved: [0, 1] });
    expect(draft()?.resolved).toEqual([0, 1]);
    await useCanvas.getState().saveDraftNote(draft()?.id as string, { body: "Why?" });
    expect(requests[0]?.body).toMatchObject({ boardId: "main", attachment, body: "Why?" });
    expect(requests[0]?.body).not.toHaveProperty("x");
  });

  test("a discarded draft leaves nothing behind", () => {
    useCanvas.getState().createNote({ x: 0, y: 0 });
    useCanvas.getState().discardDraftNote(draft()?.id as string);
    expect(useCanvas.getState().notes).toEqual([]);
    expect(useCanvas.getState().editingMarkupId).toBeNull();
    expect(requests).toHaveLength(0);
  });

  test("leaves note mode so the next click doesn't spawn another", () => {
    useCanvas.getState().createNote({ x: 0, y: 0 });
    expect(useCanvas.getState().cursorMode).toBe("select");
  });

  test("reveals the markup layer, since the new note has to be visible to edit", () => {
    useCanvas.setState({ markupVisible: false });
    useCanvas.getState().createNote({ x: 0, y: 0 });
    expect(useCanvas.getState().markupVisible).toBe(true);
  });
});

describe("setMarkupVisible", () => {
  test("hiding ends an in-progress edit rather than stranding it", () => {
    useCanvas.setState({ notes: [{ ...note, x: 0, y: 0 }], editingMarkupId: "note_1" });
    useCanvas.getState().setMarkupVisible(false);
    expect(useCanvas.getState().markupVisible).toBe(false);
    expect(useCanvas.getState().editingMarkupId).toBeNull();
  });

  test("entering comment mode brings the whole markup layer back", () => {
    useCanvas.getState().setMarkupVisible(false);
    useCanvas.getState().enterCommentMode();
    expect(useCanvas.getState().markupVisible).toBe(true);
  });

  test("starting a comment brings the whole markup layer back", () => {
    useCanvas.getState().setMarkupVisible(false);
    useCanvas.getState().beginComment({ kind: "board", boardId: "main", x: 1, y: 2 });
    expect(useCanvas.getState().markupVisible).toBe(true);
  });
});
