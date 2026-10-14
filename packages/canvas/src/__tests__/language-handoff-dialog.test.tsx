import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { $, $$, domSuite, interact, mount, press, settle, text } from "./dom.ts";

/**
 * What a kept change to the language leaves behind. Tokens reach every board
 * on their own; a colour set by hand does not, and going to look is an agent's
 * job. So the dialog's whole value is the prompt it hands over — it has to
 * name the right theme, the right boards and how to read that theme — and
 * that it gets out of the way when it is not wanted.
 */

const toasts: { kind: string | undefined; message: string }[] = [];
mock.module("../toast.ts", () => ({
  pushToast: (toast: { kind?: string; message: string }) => {
    toasts.push({ kind: toast.kind, message: toast.message });
    return "toast";
  },
  toastError: () => "toast",
}));

const { LanguageHandoffDialog } = await import(
  "../components/DesignLanguage/LanguageHandoffDialog.tsx"
);
const { useCanvas } = await import("../store.ts");

type Handoff = NonNullable<ReturnType<typeof useCanvas.getState>["languageHandoff"]>;

const copied: string[] = [];
let clipboardWorks = true;
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (value: string) => {
      if (!clipboardWorks) throw new Error("denied");
      copied.push(value);
    },
  },
});

const views: { unmount(): Promise<void> }[] = [];

async function raise(handoff: Handoff | null) {
  useCanvas.setState({ languageHandoff: handoff });
  views.push(await mount(<LanguageHandoffDialog />));
}

const dialog = () => $("[data-testid='language-handoff']");
const prompt = () => text($("[data-testid='language-handoff'] pre"));
const button = (name: string) =>
  $$("[data-testid='language-handoff'] button").find(
    (el) => text(el) === name,
  ) as HTMLButtonElement;

beforeEach(() => {
  toasts.length = 0;
  copied.length = 0;
  clipboardWorks = true;
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

domSuite("the language hand-off", () => {
  test("nothing was kept, so nothing is raised", async () => {
    await raise(null);
    expect(dialog()).toBeNull();
  });

  test("the design's own language: every board on the default theme, read with a bare get_theme", async () => {
    await raise({
      theme: "default",
      areas: ["colour", "type", "corners"],
      boards: ["Main", "Docs"],
    });
    expect(prompt()).toContain("design language of this Velloo design just changed");
    expect(prompt()).toContain("(colour, type and corners)");
    expect(prompt()).toContain("every board that uses the default theme");
    expect(prompt()).toContain("get_theme, and the rules");
    expect(prompt()).not.toContain("get_theme {");
    expect(text(dialog())).toContain("already on the 2 boards that use this theme");
  });

  test("another theme: it is named, its boards are listed, and get_theme asks for it", async () => {
    await raise({ theme: "Night", areas: ["colour", "rules"], boards: ["Night shift", "Console"] });
    expect(prompt()).toContain(
      'The "Night" theme of this Velloo design just changed (colour and rules)',
    );
    expect(prompt()).toContain("Night shift and Console:");
    expect(prompt()).toContain('get_theme { theme: "Night" }');
    expect(text(dialog())).toContain("already on the 2 boards that use Night");
  });

  test("one board and one change read as a sentence", async () => {
    await raise({ theme: "Night", areas: ["corners"], boards: ["Night shift"] });
    expect(prompt()).toContain("just changed (corners)");
    expect(prompt()).toContain("in line with it — Night shift:");
    expect(text(dialog())).toContain(
      "The change to corners is already on the board that uses Night",
    );
  });

  test("the prompt leaves the theme and the rules as the source of truth", async () => {
    await raise({ theme: "default", areas: ["colour"], boards: ["Main"] });
    expect(prompt()).toContain("Leave the theme and the rules as they are");
  });

  test("copying puts exactly the prompt on show on the clipboard", async () => {
    await raise({ theme: "Night", areas: ["type"], boards: ["Night shift"] });
    const shown = ($("[data-testid='language-handoff'] pre") as HTMLElement).textContent;
    await interact(() => button("Copy prompt for your agent").click());
    await settle();
    expect(copied).toEqual([shown as string]);
    expect(toasts).toEqual([
      { kind: "success", message: "Prompt copied — paste it to your coding agent." },
    ]);
    // The prompt stays up: copying is not the same as being done with it.
    expect(dialog()).not.toBeNull();
  });

  test("a clipboard that refuses says to select the text, which is still there", async () => {
    clipboardWorks = false;
    await raise({ theme: "default", areas: ["colour"], boards: ["Main"] });
    await interact(() => button("Copy prompt for your agent").click());
    await settle();
    expect(toasts).toEqual([
      { kind: "info", message: "Copy failed — select the prompt text instead." },
    ]);
    expect(prompt()).toContain("Bring every board");
  });

  test("Not now takes it away for good", async () => {
    await raise({ theme: "default", areas: ["colour"], boards: ["Main"] });
    await interact(() => button("Not now").click());
    expect(useCanvas.getState().languageHandoff).toBeNull();
    expect(dialog()).toBeNull();
  });

  test("so does Escape", async () => {
    await raise({ theme: "default", areas: ["colour"], boards: ["Main"] });
    await interact(() => press(dialog() as HTMLElement, "Escape"));
    expect(useCanvas.getState().languageHandoff).toBeNull();
  });
});
