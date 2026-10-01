import { expect, test } from "bun:test";
import type { CommentThreadView } from "@velloo/schema";
import { $, domSuite, interact, mount, press, settle } from "./dom.ts";

/**
 * A comment pin with previews on: hovering reads the thread at the pin,
 * clicking keeps it read, and Delete asks to delete it. Without previews (the
 * share viewer's default) a click still opens the thread straight away.
 */

const { CommentPins } = await import("../components/comment-pin.tsx");

const thread: CommentThreadView = {
  id: "8f0f6a3e-5b8e-4f1e-9d0a-2b1c3d4e5f60",
  scope: "local",
  folderId: "folder",
  boardId: "main",
  anchor: { kind: "board", boardId: "main", x: 40, y: 60 },
  origin: { kind: "local" },
  status: "open",
  messages: [
    {
      id: "0b7d7c1a-1111-4c2b-8a3d-9e8f7a6b5c4d",
      author: { kind: "user" },
      body: "Lead with the **amount**.",
      createdAt: new Date().toISOString(),
    },
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  anchorState: { status: "board" },
};

const hover = (el: Element): void => {
  el.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
};
const unhover = (el: Element): void => {
  el.dispatchEvent(
    new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
  );
};

function pins(over: Partial<Parameters<typeof CommentPins>[0]> = {}) {
  return (
    <CommentPins
      threads={[thread]}
      frames={[]}
      insets={{}}
      nodeRects={{}}
      activeId={null}
      onOpen={() => {}}
      {...over}
    />
  );
}

domSuite("comment pins", () => {
  test("hovering a pin reveals the thread; leaving hides it again", async () => {
    const view = await mount(pins({ preview: true }));
    const pin = $("[data-comment-thread]") as HTMLElement;
    await interact(() => hover(pin));
    expect($("[data-comment-preview]")?.textContent).toContain("Lead with the amount.");
    // The preview reads the message as written, formatting and all.
    expect($("[data-comment-preview] strong")?.textContent).toBe("amount");
    await interact(() => unhover(pin));
    await settle(250);
    expect($("[data-comment-preview]")).toBeNull();
    await view.unmount();
  });

  test("clicking keeps it revealed, and Open thread is what opens the thread", async () => {
    const opened: string[] = [];
    const view = await mount(pins({ preview: true, onOpen: (id) => opened.push(id) }));
    const pin = $("[data-comment-thread]") as HTMLElement;
    await interact(() => pin.click());
    await interact(() => unhover(pin));
    await settle(250);
    expect($("[data-comment-preview]")).not.toBeNull();
    expect(opened).toEqual([]);
    const open = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Open thread",
    );
    await interact(() => open?.click());
    expect(opened).toEqual([thread.id]);
    await view.unmount();
  });

  test("Delete or Backspace on a focused pin deletes the thread", async () => {
    const deleted: string[] = [];
    const view = await mount(pins({ preview: true, onDelete: (id) => deleted.push(id) }));
    await interact(() => press($("[data-comment-thread]") as HTMLElement, "Backspace"));
    expect(deleted).toEqual([thread.id]);
    await view.unmount();
  });

  test("while a comment is hovered, its bin and Delete/Backspace both delete it", async () => {
    const deleted: string[] = [];
    const view = await mount(pins({ preview: true, onDelete: (id) => deleted.push(id) }));
    const pin = $("[data-comment-thread]") as HTMLElement;
    await interact(() => hover(pin));
    await interact(() => ($("[data-comment-trash]") as HTMLElement).click());
    await interact(() => press(document.body, "Delete"));
    expect(deleted).toEqual([thread.id, thread.id]);
    await view.unmount();
  });

  test("typing elsewhere never deletes the hovered comment", async () => {
    const deleted: string[] = [];
    const view = await mount(pins({ preview: true, onDelete: (id) => deleted.push(id) }));
    await interact(() => hover($("[data-comment-thread]") as HTMLElement));
    const input = document.createElement("input");
    document.body.append(input);
    await interact(() => press(input, "Backspace"));
    expect(deleted).toEqual([]);
    input.remove();
    await view.unmount();
  });

  test("no bin where the viewer may not delete", async () => {
    const view = await mount(pins({ preview: true }));
    await interact(() => hover($("[data-comment-thread]") as HTMLElement));
    expect($("[data-comment-trash]")).toBeNull();
    await view.unmount();
  });

  test("threads on the same spot fan out as a pile", async () => {
    const view = await mount(
      pins({ threads: [thread, { ...thread, id: `${thread.id.slice(0, -1)}1` }] }),
    );
    const [first, second] = [...document.querySelectorAll<HTMLElement>("[data-comment-thread]")];
    expect(first?.style.translate).not.toContain("18px");
    expect(second?.style.translate).toContain("18px");
    await view.unmount();
  });

  test("without previews a click opens the thread, as on a share link", async () => {
    const opened: string[] = [];
    const view = await mount(pins({ onOpen: (id) => opened.push(id) }));
    const pin = $("[data-comment-thread]") as HTMLElement;
    await interact(() => hover(pin));
    expect($("[data-comment-preview]")).toBeNull();
    await interact(() => pin.click());
    expect(opened).toEqual([thread.id]);
    await view.unmount();
  });
});
