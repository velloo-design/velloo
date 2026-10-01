import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { withActor } from "../activity.ts";
import { addNote, removeNote, updateFrames, updateNote } from "../mutations/index.ts";
import { createUndoRouter } from "../routes/undo.ts";
import { designBoard, type TestContext, testContext } from "../testing/design-folder.ts";

/**
 * The canvas's undo is the person's: an agent's writes never land on it, and a
 * step whose resource an agent has rewritten since is refused rather than
 * restored over the agent's work. Notes are on the same stack as everything else.
 */

let t: TestContext;
let post: (path: string) => Promise<Response>;

const asAgent = <T>(fn: () => Promise<T>) => withActor({ source: "mcp", session: "s1" }, fn);
const asCanvas = <T>(fn: () => Promise<T>) => withActor({ source: "canvas" }, fn);

beforeEach(async () => {
  t = await testContext({
    label: "undo-scope",
    screens: { home: true },
    boards: { main: designBoard("main", ["home"]) },
  });
  const app = new Hono().route(
    "/api/undo",
    createUndoRouter(
      () => t.folder,
      () => {},
    ),
  );
  post = (path) =>
    Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { method: "POST" })));
});

afterEach(() => t.cleanup());

const frameX = () => t.folder.boards.get("main")?.frames[0]?.x;

describe("undo scope", () => {
  test("an agent's write is not an undo step", async () => {
    await asAgent(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { x: 400 } }],
      }),
    );
    expect(t.folder.history.depths()).toEqual({ undo: 0, redo: 0 });
  });

  test("undo skips nothing of the person's when an agent wrote elsewhere", async () => {
    await asCanvas(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { x: 200 } }],
      }),
    );
    await asAgent(() => addNote(t.ctx, { boardId: "main", x: 0, y: 0, body: "from the agent" }));
    const res = await post("/api/undo");
    expect(res.status).toBe(200);
    expect(frameX()).toBe(0);
    // The agent's note is untouched by the person's undo.
    expect(t.folder.notes.get("main")?.map((n) => n.body)).toEqual(["from the agent"]);
  });

  test("a step whose resource an agent rewrote since is refused, and dropped", async () => {
    await asCanvas(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { x: 200 } }],
      }),
    );
    await asAgent(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { y: 300 } }],
      }),
    );
    const res = await post("/api/undo");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("changed-since");
    // The agent's y and the person's x both survive.
    expect(t.folder.boards.get("main")?.frames[0]).toMatchObject({ x: 200, y: 300 });
    expect(t.folder.history.depths()).toEqual({ undo: 0, redo: 0 });
  });

  test("redo is refused the same way once an agent has written the resource", async () => {
    await asCanvas(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { x: 200 } }],
      }),
    );
    await post("/api/undo");
    await asAgent(() =>
      updateFrames(t.ctx, {
        boardId: "main",
        patches: [{ frameId: "frame-home", patch: { y: 300 } }],
      }),
    );
    const res = await post("/api/undo/redo");
    expect(res.status).toBe(409);
    expect(t.folder.boards.get("main")?.frames[0]).toMatchObject({ x: 0, y: 300 });
  });
});

describe("notes on the undo stack", () => {
  test("creating, editing and removing a note are each one step, and redo replays them", async () => {
    const added = await asCanvas(() =>
      addNote(t.ctx, { boardId: "main", x: 10, y: 20, width: 300, height: 120, body: "First" }),
    );
    if (!added.ok) throw new Error("add failed");
    const noteId = added.value.note.id;
    expect(added.value.note).toMatchObject({ width: 300, height: 120 });

    // Past the coalescing window, so the edit is a step of its own.
    await Bun.sleep(850);
    await asCanvas(() => updateNote(t.ctx, { boardId: "main", noteId, patch: { body: "Edited" } }));
    await Bun.sleep(850);
    await asCanvas(() => removeNote(t.ctx, { boardId: "main", noteId }));
    expect(t.folder.history.depths().undo).toBe(3);

    await post("/api/undo");
    expect(t.folder.notes.get("main")?.map((n) => n.body)).toEqual(["Edited"]);
    await post("/api/undo");
    expect(t.folder.notes.get("main")?.map((n) => n.body)).toEqual(["First"]);
    await post("/api/undo");
    expect(t.folder.notes.get("main") ?? []).toEqual([]);

    await post("/api/undo/redo");
    expect(t.folder.notes.get("main")?.[0]).toMatchObject({
      id: noteId,
      body: "First",
      height: 120,
    });
  });
});
