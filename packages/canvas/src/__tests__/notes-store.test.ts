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
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  useCanvas.setState({ notes: [], editingMarkupId: null, cursorMode: "select" });
});

describe("createNote", () => {
  test("a free note posts board coordinates and opens its editor", async () => {
    await useCanvas.getState().createNote({ x: 40, y: 80 });
    expect(requests[0]?.path).toBe("/api/notes/add");
    expect(requests[0]?.body).toMatchObject({ boardId: "main", x: 40, y: 80, body: "" });
    expect(useCanvas.getState().notes).toHaveLength(1);
    expect(useCanvas.getState().editingMarkupId).toBe("note_1");
  });

  test("an attached note posts its anchor instead of coordinates", async () => {
    const attachment = { frameId: "fr_home", screenId: "home", locator: "@cta" };
    await useCanvas.getState().createNote({ attachment });
    expect(requests[0]?.body).toMatchObject({ boardId: "main", attachment });
    expect(requests[0]?.body).not.toHaveProperty("x");
  });

  test("leaves note mode so the next click doesn't spawn another", async () => {
    await useCanvas.getState().createNote({ x: 0, y: 0 });
    expect(useCanvas.getState().cursorMode).toBe("select");
  });

  test("reveals the markup layer, since the new note has to be visible to edit", async () => {
    useCanvas.setState({ markupVisible: false });
    await useCanvas.getState().createNote({ x: 0, y: 0 });
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
