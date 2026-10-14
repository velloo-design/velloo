import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Board, Theme } from "@velloo/schema";
import { $, $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * What the Theme rail does that the design-language stage does not. It edits
 * whichever theme the board on screen uses, it is where the named typeset
 * presets live, and it is one of the ways into the stage — which then has to
 * open on that same theme, or the two would be editing different files.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const { ThemePanel } = await import("../components/ThemePanel.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

const SECTIONS = "velloo:theme-panel:sections";

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

const themed = (typesets: Record<string, object> = {}): Theme =>
  ({
    name: "Night",
    colors: { background: "#111111", foreground: "#fafafa", primary: "#818cf8" },
    typography: { typesets },
    spacing: {},
    radius: { md: "0.5rem" },
  }) as unknown as Theme;

async function rail(theme: Theme, open: string[] = ["type"]) {
  localStorage.setItem(SECTIONS, JSON.stringify(open));
  useCanvas.setState({ theme, themeName: theme.name });
  const view = await mount(<ThemePanel theme={theme} />);
  views.push(view);
  await settle();
  return view;
}

const labelled = (label: string) => $(`[aria-label='${label}']`) as HTMLElement;
const presets = () => $$("button[aria-pressed]").map((el) => text(el));
const selected = () =>
  $$("button[aria-pressed='true']")
    .map((el) => text(el))
    .join();
const typesetWrites = () =>
  server.themeWrites.map((w) => {
    expect(w.op).toBe("set_typeset");
    return w.args as { typesets: unknown[]; theme: string };
  });

async function name(label: string, value: string): Promise<void> {
  const input = labelled(label) as HTMLInputElement;
  await interact(() => typeInto(input, value));
  await interact(() => press(input, "Enter"));
  await settle();
}

beforeEach(() => {
  toasts.length = 0;
  localStorage.clear();
  setApiConnected(true);
  server = serveFolder({
    boards: { main: ["home"], night: ["console"] },
    boardThemes: { night: "Night" },
  });
  useCanvas.setState({
    view: "boards",
    design: server.design as never,
    boards: server.boards as Record<string, Board>,
    currentBoardId: "night",
    folderConfig: null,
    designMode: "light",
    frameworkRoles: null,
    typesetDraft: null,
    fontDraft: null,
    wsConnected: true,
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("typeset presets", () => {
  test("a new preset authors nothing, and is the one being edited once it exists", async () => {
    const view = await rail(themed({ default: {} }));
    expect(presets()).toEqual(["default"]);
    await interact(() => labelled("New preset").click());
    await name("New preset name", "docs");
    // Only a name: every control inherits from the baseline until one is moved.
    expect(typesetWrites()).toEqual([{ typesets: [{ name: "docs" }], theme: "Night" }]);

    // The write coming back as a changed theme is what makes it selectable.
    await view.render(<ThemePanel theme={themed({ default: {}, docs: {} })} />);
    expect(presets()).toEqual(["default", "docs"]);
    expect(selected()).toBe("docs");
    expect(text(document.body)).toContain(".typeset-docs");
  });

  test("renaming keeps the preset in hand under its new name", async () => {
    const view = await rail(themed({ default: {}, docs: { leading: 1.7 } }));
    await interact(() =>
      $$("button[aria-pressed]")
        .find((el) => text(el) === "docs")
        ?.click(),
    );
    await interact(() => labelled("Rename docs").click());
    await name("Rename preset", "prose");
    expect(typesetWrites()).toEqual([
      { typesets: [{ name: "docs", renameTo: "prose" }], theme: "Night" },
    ]);

    await view.render(<ThemePanel theme={themed({ default: {}, prose: { leading: 1.7 } })} />);
    expect(selected()).toBe("prose");
  });

  test("deleting asks first, then falls back to the baseline", async () => {
    const view = await rail(themed({ default: {}, docs: {} }));
    await interact(() =>
      $$("button[aria-pressed]")
        .find((el) => text(el) === "docs")
        ?.click(),
    );
    await interact(() => labelled("Delete docs").click());
    expect(server.themeWrites).toEqual([]);
    expect(text($("[role='alertdialog']"))).toContain('Delete the "docs" typeset');

    await interact(() =>
      (
        $$("[role='alertdialog'] button").find((el) => text(el) === "Delete") as HTMLElement
      ).click(),
    );
    await settle();
    expect(typesetWrites()).toEqual([
      { typesets: [{ name: "docs", remove: true }], theme: "Night" },
    ]);

    await view.render(<ThemePanel theme={themed({ default: {} })} />);
    expect(selected()).toBe("default");
  });

  test("the baseline can be neither renamed nor deleted", async () => {
    await rail(themed({ default: {}, docs: {} }));
    expect(selected()).toBe("default");
    expect($("[aria-label='Rename default']")).toBeNull();
    expect($("[aria-label='Delete default']")).toBeNull();
    expect(text(document.body)).toContain(":root — styles every screen");
  });

  test("a preset the server refuses is reported and the theme re-read", async () => {
    server.fail("/api/theme/set_typeset");
    await rail(themed({ default: {} }));
    const reads = () => server.calls.filter((path) => path.startsWith("/api/theme?")).length;
    const before = reads();
    await interact(() => labelled("New preset").click());
    await name("New preset name", "docs");
    await settle(10);
    expect(toasts).toEqual(["Could not update the typeset"]);
    expect(reads()).toBe(before + 1);
  });
});

domSuite("which sections the rail opens with", () => {
  const open = () =>
    $$("[data-slot='accordion-trigger'][aria-expanded='true']").map((el) => text(el));

  test("the ones left open last time", async () => {
    await rail(themed(), ["shape", "type"]);
    expect(open()).toEqual(["Type", "Shape"]);
  });

  test("all closed, if that is how it was left", async () => {
    await rail(themed(), []);
    expect(open()).toEqual([]);
  });

  test("colour, when what was remembered names sections the rail no longer has", async () => {
    await rail(themed(), ["tokens", "fonts"]);
    expect(open()).toEqual(["Colour"]);
  });

  test("colour, when what was remembered is not a list at all", async () => {
    localStorage.setItem(SECTIONS, "{not json");
    useCanvas.setState({ theme: themed(), themeName: "Night" });
    views.push(await mount(<ThemePanel theme={themed()} />));
    expect(open()).toEqual(["Colour"]);
  });

  test("opening one is remembered", async () => {
    await rail(themed(), ["colour"]);
    await interact(() =>
      (
        $$("[data-slot='accordion-trigger']").find((el) => text(el) === "Shape") as HTMLElement
      ).click(),
    );
    expect(JSON.parse(localStorage.getItem(SECTIONS) as string)).toEqual(["colour", "shape"]);
  });
});

domSuite("from the rail into the stage", () => {
  test("the stage opens for review on the theme this board uses", async () => {
    await rail(themed(), ["colour"]);
    await interact(() =>
      ($$("button").find((el) => text(el) === "Open the design language") as HTMLElement).click(),
    );
    await settle(10);
    const state = useCanvas.getState();
    expect([state.view, state.languageMode, state.languageTheme]).toEqual([
      "language",
      "review",
      "Night",
    ]);
    expect(state.languageBaseline?.theme.name).toBe("Night");
  });

  test("a stage that could not open says so", async () => {
    server.fail("/api/design-language");
    await rail(themed(), ["colour"]);
    await interact(() =>
      ($$("button").find((el) => text(el) === "Open the design language") as HTMLElement).click(),
    );
    await settle(10);
    expect(toasts).toEqual(["Could not open"]);
  });
});
