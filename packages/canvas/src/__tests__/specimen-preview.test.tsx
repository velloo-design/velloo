import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { $, $$, domSuite, interact, layOut, mount, text } from "./dom.ts";

/**
 * The specimen beside the design-language stage. It is the only thing that
 * shows what an edit did, so what it has to get right is its subject: the
 * theme the stage is on, in the palette the role editor is working in, as the
 * theme stands now — and it has to get there without blanking, since every
 * colour nudge is a reload.
 */

const light = {
  name: "default",
  colors: { background: "#ffffff", foreground: "#111111", primary: "#4f46e5" },
  typography: {},
  spacing: {},
  radius: {},
} as unknown as Theme;
const withDark = { ...light, colorsDark: { background: "#111111" } } as unknown as Theme;

/** The pane's measured size is whatever a test says it is. */
let pane = { w: 1120, h: 800 };
layOut("[data-specimen]", () => pane);

/** A pane resize, as the browser would report one. */
const resizeListeners = new Set<() => void>();
globalThis.ResizeObserver = class {
  private readonly report: () => void;
  constructor(callback: ResizeObserverCallback) {
    this.report = () => callback([], this as unknown as ResizeObserver);
  }
  observe(): void {
    resizeListeners.add(this.report);
  }
  unobserve(): void {}
  disconnect(): void {
    resizeListeners.delete(this.report);
  }
} as unknown as typeof ResizeObserver;

const { SpecimenPreview } = await import("../components/DesignLanguage/SpecimenPreview.tsx");
const { useCanvas } = await import("../store.ts");

const views: { unmount(): Promise<void> }[] = [];

async function show(state: Partial<ReturnType<typeof useCanvas.getState>> = {}) {
  useCanvas.setState({
    theme: light,
    themeVersion: 1,
    languageTheme: "default",
    languageScheme: "light",
    cursorMode: "select",
    typesetDraft: null,
    fontDraft: null,
    ...state,
  });
  const view = await mount(<SpecimenPreview />);
  views.push(view);
  return view;
}

const frames = () => $$("[data-specimen]").map((el) => el.getAttribute("data-specimen"));
const iframes = (scheme: string) => $$(`[data-specimen="${scheme}"] iframe`) as HTMLIFrameElement[];
/** The document on show — the back buffer is hidden from assistive tech and from sight. */
const front = (scheme: string) =>
  iframes(scheme).find((f) => f.getAttribute("aria-hidden") !== "true") as HTMLIFrameElement;
const back = (scheme: string) =>
  iframes(scheme).find((f) => f.getAttribute("aria-hidden") === "true");
const src = (scheme: string) => new URL(front(scheme).getAttribute("src") as string, "http://x");
const toggle = (name: string) =>
  $$("[role='radio']").find((el) => text(el) === name) as HTMLButtonElement;
const noDarkNote = () => text(document.body).includes("no dark palette yet");

async function load(el: HTMLIFrameElement): Promise<void> {
  await interact(() => {
    el.dispatchEvent(new window.Event("load"));
  });
}

beforeEach(() => {
  pane = { w: 1120, h: 800 };
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
});

domSuite("the specimen's subject", () => {
  test("it renders the theme the stage is on, not always the default", async () => {
    await show({ languageTheme: "Brand B" });
    expect(src("light").pathname).toBe("/api/render/specimen");
    expect(src("light").searchParams.get("theme")).toBe("Brand B");
    expect(src("light").searchParams.get("mode")).toBe("light");
  });

  test("the default theme is asked for by leaving the theme out", async () => {
    await show();
    expect(src("light").searchParams.has("theme")).toBe(false);
  });

  test("it opens in the palette the role editor is working in", async () => {
    await show({ languageScheme: "dark", theme: withDark });
    expect(frames()).toEqual(["dark"]);
    expect(src("dark").searchParams.get("mode")).toBe("dark");
    expect(toggle("Dark").getAttribute("aria-checked")).toBe("true");
  });
});

domSuite("light, dark and both", () => {
  test("switching to dark switches the stage's palette with it", async () => {
    await show({ theme: withDark });
    await interact(() => toggle("Dark").click());
    // One switch for the specimen and the role editor: the colours on show
    // are the colours being edited.
    expect(useCanvas.getState().languageScheme).toBe("dark");
    expect(frames()).toEqual(["dark"]);
  });

  test("both is this pane's own view and leaves the palette being edited alone", async () => {
    await show({ theme: withDark, languageScheme: "dark" });
    await interact(() => toggle("Both").click());
    expect(frames()).toEqual(["light", "dark"]);
    expect(src("light").searchParams.get("mode")).toBe("light");
    expect(src("dark").searchParams.get("mode")).toBe("dark");
    expect(useCanvas.getState().languageScheme).toBe("dark");
  });

  test("leaving both for one scheme goes back to a single render of it", async () => {
    await show({ theme: withDark });
    await interact(() => toggle("Both").click());
    await interact(() => toggle("Light").click());
    expect(frames()).toEqual(["light"]);
    expect(useCanvas.getState().languageScheme).toBe("light");
  });

  test("a scheme changed from the role editor is followed", async () => {
    await show({ theme: withDark });
    await interact(() => useCanvas.getState().setLanguageScheme("dark"));
    expect(frames()).toEqual(["dark"]);
  });

  test("a theme with no dark palette says dark is showing light — only while dark is on show", async () => {
    await show();
    expect(noDarkNote()).toBe(false);
    await interact(() => toggle("Dark").click());
    expect(noDarkNote()).toBe(true);
    await interact(() => toggle("Both").click());
    expect(noDarkNote()).toBe(true);
    await interact(() => toggle("Light").click());
    expect(noDarkNote()).toBe(false);
  });

  test("a theme that has a dark palette is not apologised for", async () => {
    await show({ theme: withDark, languageScheme: "dark" });
    expect(noDarkNote()).toBe(false);
  });
});

domSuite("following the theme as it is edited", () => {
  test("the first render is covered until it arrives", async () => {
    await show();
    expect($("[data-specimen] [role='status']")).not.toBeNull();
    await load(front("light"));
    expect($("[data-specimen] [role='status']")).toBeNull();
  });

  test("an edit loads behind the render on show and replaces it only once loaded", async () => {
    await show();
    await load(front("light"));
    const before = front("light").getAttribute("src");

    await interact(() => useCanvas.setState({ themeVersion: 2 }));
    expect(front("light").getAttribute("src")).toBe(before);
    const pending = back("light")?.getAttribute("src");
    expect(pending).not.toBe(before);
    // Never blank again: the old render stays up, with nothing drawn over it.
    expect($("[data-specimen] [role='status']")).toBeNull();

    await load(back("light") as HTMLIFrameElement);
    expect(front("light").getAttribute("src")).toBe(pending as string);
    expect(iframes("light")).toHaveLength(1);
  });

  test("the new render opens where the last one was scrolled", async () => {
    await show();
    const scrolled: Array<() => void> = [];
    const shown = {
      scrollX: 0,
      scrollY: 0,
      addEventListener: (_: string, fn: () => void) => scrolled.push(fn),
    };
    Object.defineProperty(front("light"), "contentWindow", { value: shown });
    await load(front("light"));
    shown.scrollY = 640;
    for (const fn of scrolled) fn();

    await interact(() => useCanvas.setState({ themeVersion: 2 }));
    const moved: Array<[number, number]> = [];
    Object.defineProperty(back("light"), "contentWindow", {
      value: {
        addEventListener: () => {},
        scrollTo: (x: number, y: number) => moved.push([x, y]),
      },
    });
    await load(back("light") as HTMLIFrameElement);
    expect(moved).toEqual([[0, 640]]);
  });

  test("a face being browsed is painted on the specimen before it is committed", async () => {
    await show();
    const doc = new DOMParser().parseFromString(
      "<html><head></head><body></body></html>",
      "text/html",
    );
    Object.defineProperty(front("light"), "contentDocument", { value: doc });
    await load(front("light"));

    // A system face: nothing to fetch, so the override is the whole preview.
    await interact(() =>
      useCanvas.setState({
        fontDraft: { role: "display", family: "Georgia", stack: "Georgia, serif" },
      }),
    );
    expect(doc.getElementById("__velloo-theme-draft")?.textContent).toContain(
      "--font-display: Georgia, serif",
    );

    await interact(() => useCanvas.setState({ fontDraft: null }));
    expect(doc.getElementById("__velloo-theme-draft")).toBeNull();
  });
});

domSuite("fitting the pane", () => {
  const box = () => {
    const { width, height, transform } = front("light").style;
    return { width, height, transform };
  };

  test("a pane as wide as the specimen shows it at full size", async () => {
    pane = { w: 1400, h: 700 };
    await show();
    expect(box()).toEqual({ width: "1400px", height: "700px", transform: "" });
  });

  test("a narrower pane scales it down rather than reflowing it", async () => {
    pane = { w: 560, h: 400 };
    await show();
    // Laid out at its own width, then shrunk to fit: the specimen is not a
    // responsive page, and at 560px it would be a different one.
    expect(box()).toEqual({ width: "1120px", height: "800px", transform: "scale(0.5)" });
  });

  test("it refits when the pane is resized", async () => {
    await show();
    expect(box().transform).toBe("");
    pane = { w: 840, h: 600 };
    await interact(() => {
      for (const report of resizeListeners) report();
    });
    expect(box()).toEqual({ width: "1120px", height: "800px", transform: "scale(0.75)" });
  });
});
