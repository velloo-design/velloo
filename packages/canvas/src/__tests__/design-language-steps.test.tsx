import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Board, Theme } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The stage as someone works through it, opened the way the canvas opens it
 * and answered by a daemon. What its four steps have in common is their
 * subject: whichever theme the stage is on is the one every control here
 * writes to, and what is said about the language — what fails, what is set,
 * whose rules these are — has to be true of that theme and that design.
 */

const toasts: { kind: string | undefined; message: string }[] = [];
mock.module("../toast.ts", () => ({
  pushToast: (toast: { kind?: string; message: string }) => {
    toasts.push({ kind: toast.kind, message: toast.message });
    return "toast";
  },
  toastError: (_err: unknown, fallback: string) => {
    toasts.push({ kind: "error", message: fallback });
    return "toast";
  },
}));

// The font browser fetches a row's face once the row scrolls into view. Here
// none ever does, so browsing reaches for no webfont.
globalThis.IntersectionObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof IntersectionObserver;

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

const { LanguageStage } = await import("../components/DesignLanguage/LanguageStage.tsx");
const { PROPOSE_LANGUAGE_PROMPT } = await import("../components/DesignLanguage/agent-prompt.ts");
const { readLanguageSet } = await import("../components/DesignLanguage/language-set.ts");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { normalizeToOklch } = await import("../color.ts");

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

/** A face no catalogue knows, so listing it previews nothing. */
const faces = { fontFamily: { sans: "system-ui, sans-serif" } };

async function openStage(mode: "guided" | "review" = "review", theme?: string) {
  useCanvas.setState({
    design: server.design as never,
    boards: server.boards as Record<string, Board>,
    currentBoardId: "main",
    wsConnected: true,
  });
  await useCanvas.getState().openLanguage(mode, theme);
  views.push(await mount(<LanguageStage />));
  await settle();
}

const stage = () => $("[data-language-stage]") as HTMLElement;
const button = (name: string) =>
  $$("button").find((el) => text(el).startsWith(name)) as HTMLButtonElement | undefined;
/** A step in the review list, by its label; its text carries the summary under it. */
const step = (label: string) =>
  $$("[data-language-stage] nav button").find((el) => text(el).startsWith(label)) as HTMLElement;
const goTo = (label: string) => interact(() => step(label).click());
const radio = (name: string) =>
  $$("[role='radio']").find((el) => text(el) === name) as HTMLButtonElement;

beforeEach(() => {
  toasts.length = 0;
  copied.length = 0;
  clipboardWorks = true;
  localStorage.clear();
  setApiConnected(true);
  server = serveFolder({
    boards: { main: ["home"], night: ["console"] },
    boardThemes: { night: "Night" },
  });
  server.design.folderId = "design-a";
  for (const theme of Object.values(server.themes)) {
    Object.assign(theme, { typography: faces, radius: { md: "0.5rem" } });
  }
  useCanvas.setState({
    view: "boards",
    folderConfig: null,
    theme: null,
    themeName: "default",
    designMode: "light",
    languageHandoff: null,
    fontDraft: null,
    typesetDraft: null,
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("what the review list says of each step", () => {
  test("a language whose text pairs all pass says so, with nothing flagged", async () => {
    server.contrast = [{ tier: "AA" }, { tier: "AAA" }];
    await openStage();
    expect(text(step("Colour"))).toBe("ColourEvery text pair passes contrast");
    expect($("[aria-label='Needs attention']")).toBeNull();
  });

  test("failing pairs are counted on the Colour step and flagged from any step", async () => {
    server.contrast = [{ tier: "Fail" }, { tier: "AA" }, { tier: "Fail" }];
    await openStage();
    await goTo("Rules");
    expect(text(step("Colour"))).toBe("Colour2 text pairs fail contrast");
    expect(step("Colour").querySelector("[aria-label='Needs attention']")).not.toBeNull();
  });

  test("one failing pair is one pair", async () => {
    server.contrast = [{ tier: "Fail" }];
    await openStage();
    expect(text(step("Colour"))).toBe("Colour1 text pair fails contrast");
  });

  test("the pairs scored are the stage's theme's, and are scored again when it changes", async () => {
    await openStage("review", "Night");
    expect(server.calls).toContain("/api/theme/contrast?name=Night");
    expect(text(step("Colour"))).toContain("Every text pair passes");

    server.contrast = [{ tier: "Fail" }];
    await interact(() => useCanvas.setState((s) => ({ themeVersion: s.themeVersion + 1 })));
    await settle();
    expect(text(step("Colour"))).toContain("1 text pair fails contrast");
  });

  test("shape and rules are summed up in words", async () => {
    server.rules = {
      source: { path: "guidance.md", writable: true },
      intent: "",
      rules: [
        { kind: "do", text: "One accent" },
        { kind: "dont", text: "Gradients" },
        { kind: "dont", text: "Drop shadows" },
      ],
    };
    await openStage();
    expect(text(step("Shape"))).toBe("ShapeSoft · 8px corners");
    expect(text(step("Rules"))).toBe("Rules1 do · 2 don't");
  });

  test("no rules, and a radius the control cannot show, are said plainly", async () => {
    Object.assign(server.themes.default as Theme, { radius: { md: "calc(1rem - 2px)" } });
    await openStage();
    expect(text(step("Rules"))).toBe("RulesNone stated");
    expect(text(step("Shape"))).toBe("ShapeCustom radius");
    await goTo("Shape");
    expect(text(stage())).toContain(
      "The theme's radius is calc(1rem - 2px), which this control can't show.",
    );
  });
});

domSuite("every step writes to the theme the stage is on", () => {
  test("a role recoloured on another theme is written to that theme", async () => {
    await openStage("review", "Night");
    const background = document.getElementById("token-colors.background") as HTMLInputElement;
    await interact(() => typeInto(background, "#0b1020"));
    await settle(320);
    expect(server.themeWrites).toEqual([
      {
        op: "set_token",
        args: { path: "colors.background", value: normalizeToOklch("#0b1020"), theme: "Night" },
      },
    ]);
  });

  test("a corner preset sets that theme's base radius", async () => {
    await openStage("review", "Night");
    await goTo("Shape");
    expect(radio("Soft").getAttribute("aria-checked")).toBe("true");
    await interact(() => radio("Pill").click());
    await settle();
    expect(server.themeWrites).toEqual([
      { op: "set_radius", args: { value: "1.25rem", theme: "Night" } },
    ]);
    expect(text(stage())).toContain("20px");
  });

  test("clicking the corner it is already on does not flatten it", async () => {
    await openStage();
    await goTo("Shape");
    await interact(() => radio("Soft").click());
    await settle();
    expect(server.themeWrites).toEqual([]);
    expect(text(stage())).toContain("8px");
  });

  test("a radius the server refuses is reported", async () => {
    server.fail("/api/theme/set_radius");
    await openStage();
    await goTo("Shape");
    await interact(() => radio("Sharp").click());
    await settle();
    expect(toasts).toEqual([{ kind: "error", message: "Could not set the corner radius" }]);
  });
});

domSuite("choosing a face", () => {
  const face = (role: string) =>
    $$("[data-language-stage] button, aside button").find(
      (el) => el.getAttribute("title") === "system-ui, sans-serif" && text(el).startsWith(role),
    ) as HTMLButtonElement;
  const browsing = () => $("button[aria-label='Back to theme']") !== null;
  const family = (name: string) =>
    $$("aside button").find((el) => text(el).startsWith(name)) as HTMLButtonElement;

  test("a face's row swaps the rail for the browser, and Back swaps it back unchanged", async () => {
    await openStage();
    await goTo("Type");
    await interact(() => face("sans").click());
    expect(browsing()).toBe(true);
    expect(text($("aside"))).toContain("Face for sans");
    // The steps are gone while browsing: the specimen beside it is the preview.
    expect($("[data-language-stage]")).toBeNull();

    await interact(() => ($("button[aria-label='Back to theme']") as HTMLButtonElement).click());
    expect(browsing()).toBe(false);
    expect(server.themeWrites).toEqual([]);
    // Back where it was left, not at the first step.
    expect(step("Type").getAttribute("aria-current")).toBe("page");
  });

  test("picking a family puts it on that role, in the stage's theme", async () => {
    await openStage("review", "Night");
    await goTo("Type");
    await interact(() => face("sans").click());
    await interact(() => family("Manrope").click());
    await settle();
    expect(browsing()).toBe(false);
    expect(server.themeWrites).toHaveLength(1);
    expect(server.themeWrites[0]).toMatchObject({
      op: "set_fonts",
      args: {
        theme: "Night",
        fonts: [{ role: "sans", family: "Manrope", google: "wght@200..800" }],
      },
    });
  });

  test("the stage sets the baseline rhythm only: presets are the rail's tool", async () => {
    await openStage();
    await goTo("Type");
    expect(text(stage())).toContain("Rhythm");
    expect($("button[aria-label='New preset']")).toBeNull();
  });

  test("a family that could not be set is reported and the theme re-read", async () => {
    server.fail("/api/theme/set_fonts");
    await openStage();
    await goTo("Type");
    await interact(() => face("sans").click());
    const reads = () => server.calls.filter((path) => path === "/api/theme").length;
    const before = reads();
    await interact(() => family("Manrope").click());
    await settle(10);
    expect(toasts).toEqual([{ kind: "error", message: "Could not set the face" }]);
    // A rejected pick leaves frames painted with a face the theme does not have.
    expect(reads()).toBe(before + 1);
  });
});

domSuite("the rules belong to the design, not the theme", () => {
  const note = "Rules belong to the whole design";

  test("a design with one theme is not told so", async () => {
    delete server.themes.Night;
    await openStage();
    await goTo("Rules");
    expect(text(stage())).not.toContain(note);
  });

  test("on another theme the rules step says they are every theme's", async () => {
    await openStage("review", "Night");
    await goTo("Rules");
    expect(text(stage())).toContain(note);
  });

  test("so does the default theme once the design has more than one", async () => {
    await openStage();
    await goTo("Rules");
    expect(text(stage())).toContain(note);
    expect(text(stage())).toContain("on the boards that use this theme");
  });
});

domSuite("an agent's proposal", () => {
  const offer = () => button("Copy a prompt to have your agent propose one");

  test("the design's own language can be asked of an agent, with the prompt on the clipboard", async () => {
    await openStage();
    await interact(() => offer()?.click());
    await settle();
    expect(copied).toEqual([PROPOSE_LANGUAGE_PROMPT]);
    expect(toasts).toEqual([
      { kind: "success", message: "Prompt copied — paste it to your coding agent." },
    ]);
  });

  test("a clipboard that refuses says what to ask for instead", async () => {
    clipboardWorks = false;
    await openStage();
    await interact(() => offer()?.click());
    await settle();
    expect(toasts).toEqual([
      { kind: "info", message: "Copy failed — ask your agent to propose a design language." },
    ]);
  });

  test("another theme is a person's variation: no agent is offered", async () => {
    await openStage("review", "Night");
    expect(offer()).toBeUndefined();
  });

  test("nor while being walked through defining one", async () => {
    await openStage("guided");
    expect(offer()).toBeUndefined();
  });
});

domSuite("leaving", () => {
  test("Done on the design's own language is what marks it as set", async () => {
    await openStage();
    expect(readLanguageSet("design-a")).toBe(false);
    await interact(() => button("Done")?.click());
    await settle(10);
    expect(readLanguageSet("design-a")).toBe(true);
    expect(useCanvas.getState().view).toBe("boards");
  });

  test("Done on another theme does not settle the design's language", async () => {
    await openStage("review", "Night");
    await interact(() => button("Done")?.click());
    await settle(10);
    expect(readLanguageSet("design-a")).toBe(false);
  });

  test("Cancel is not Done: an untouched visit marks nothing", async () => {
    await openStage();
    await interact(() => button("Cancel")?.click());
    await settle(10);
    expect(readLanguageSet("design-a")).toBe(false);
    expect(server.restores).toEqual([]);
  });

  test("a new theme says what Done and Cancel will do, and discarding it names it", async () => {
    useCanvas.setState({
      boards: server.boards as Record<string, Board>,
      currentBoardId: "main",
      wsConnected: true,
    });
    await useCanvas.getState().startTheme("Dusk");
    views.push(await mount(<LanguageStage />));
    await settle();
    expect(text(stage())).toContain("A new theme. Done puts this board on it; Cancel discards it.");
    expect(text($("[data-language-theme]"))).toBe("Dusk");

    await interact(() =>
      useCanvas.setState((s) => ({ theme: { ...(s.theme as Theme), radius: { md: "0rem" } } })),
    );
    await interact(() => button("Cancel")?.click());
    expect(text($("[role='alertdialog']"))).toContain("Discard Dusk?");
    expect(text($("[role='alertdialog']"))).toContain("The new theme is removed");

    await interact(() => button("Discard")?.click());
    await settle(10);
    expect(Object.keys(server.themes)).not.toContain("Dusk");
    expect(server.mutations).toEqual([]);
  });

  test("changing your mind about discarding keeps the stage and the changes", async () => {
    await openStage();
    await interact(() =>
      useCanvas.setState((s) => ({ theme: { ...(s.theme as Theme), radius: { md: "0rem" } } })),
    );
    await interact(() => button("Cancel")?.click());
    expect(text($("[role='alertdialog']"))).toContain("Discard these changes?");
    await interact(() =>
      (
        $$("[role='alertdialog'] button").find((el) => text(el) === "Cancel") as HTMLElement
      ).click(),
    );
    await settle(10);
    expect(server.restores).toEqual([]);
    expect(useCanvas.getState().view).toBe("language");
  });
});

domSuite("being walked through it", () => {
  const tab = (name: string) =>
    $$("[data-language-stage] [role='tab']").find((el) => text(el) === name) as HTMLButtonElement;

  test("Back returns to a step already taken, and the ones reached stay open", async () => {
    await openStage("guided");
    expect(button("Back")?.disabled).toBe(true);
    await interact(() => button("Next: Type")?.click());
    await interact(() => button("Next: Shape")?.click());
    expect(text(stage())).toContain("Step 3 of 4.");

    await interact(() => button("Back")?.click());
    expect(text(stage())).toContain("Step 2 of 4.");
    // Going back does not take away what was already reached.
    expect(tab("Shape").disabled).toBe(false);
    expect(tab("Rules").disabled).toBe(true);
  });

  test("Done is offered at the last step, in place of Next", async () => {
    await openStage("guided");
    for (const next of ["Next: Type", "Next: Shape", "Next: Rules"]) {
      expect(button("Done")).toBeUndefined();
      await interact(() => button(next)?.click());
    }
    expect(button("Next")).toBeUndefined();
    expect(button("Done")).toBeDefined();
  });
});

domSuite("when there is nothing it can save", () => {
  test("the stage cannot be edited, like every other pane that writes", async () => {
    await openStage();
    expect(stage().hasAttribute("inert")).toBe(false);
    await interact(() => useCanvas.setState({ wsConnected: false }));
    expect(stage().hasAttribute("inert")).toBe(true);
  });

  test("it waits for the theme and the rules before offering anything to change", async () => {
    useCanvas.setState({ view: "language", theme: null, languageBaseline: null });
    views.push(await mount(<LanguageStage />));
    expect($("[data-language-stage]")).toBeNull();
    expect(text($("aside"))).toContain("Opening the design language");
  });
});
