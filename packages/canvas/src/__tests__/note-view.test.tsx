import { expect, test } from "bun:test";
import { $, domSuite, interact, mount, settle } from "./dom.ts";

/**
 * The read-only notes the share viewer renders: the canvas's look, no editing.
 * Free notes are text on the board; attached ones open on hover and on click.
 */

const { NotesView } = await import("../components/note-view.tsx");

const frames = [{ id: "fr_home", screen: "home", x: 0, y: 0, w: 600, h: 400 }];
const free = { id: "note_f", x: 10, y: 20, width: 240, height: 90, body: "**Free** words" };
const attached = {
  id: "note_a",
  width: 240,
  body: "Pinned words",
  attachment: { frameId: "fr_home", screenId: "home", locator: "@cta" },
  resolved: [0],
};

const hover = (el: Element): void => {
  el.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
};
const unhover = (el: Element): void => {
  el.dispatchEvent(
    new window.MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
  );
};

function view(notes: object[]) {
  return (
    <NotesView
      notes={notes as never}
      frames={frames as never}
      insets={{ fr_home: { x: 0, y: 20 } }}
      nodeRects={{ fr_home: { "0": { x: 20, y: 30, w: 80, h: 40 } } }}
    />
  );
}

domSuite("notes view", () => {
  test("a free note reads as text on the board, at its size, with nothing to edit", async () => {
    const mounted = await mount(view([free]));
    const note = $("[data-note-id='note_f']") as HTMLElement;
    expect(note.style.height).toBe("90px");
    expect(note.querySelector("strong")?.textContent).toBe("Free");
    expect(note.className).not.toContain("bg-amber");
    expect($("[data-note-trash], [data-rich-editor], [data-note-resize]")).toBeNull();
    await mounted.unmount();
  });

  test("an attached note opens on hover and stays open once clicked", async () => {
    const mounted = await mount(view([attached]));
    const marker = $("[data-note-marker]") as HTMLElement;
    expect($("[data-note-card]")).toBeNull();
    await interact(() => hover(marker));
    expect($("[data-note-card]")?.textContent).toContain("Pinned words");
    await interact(() => marker.click());
    await interact(() => unhover(marker));
    await settle(250);
    expect($("[data-note-card]")).not.toBeNull();
    await mounted.unmount();
  });
});

test("velloo-cloud's pan guard skips the notes", async () => {
  // `data-stop-pan` is how the share viewer tells a note from empty board.
  const source = await Bun.file(new URL("../components/note-view.tsx", import.meta.url)).text();
  expect(source.match(/data-stop-pan/g)?.length).toBeGreaterThanOrEqual(3);
});
