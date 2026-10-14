import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

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

const { LanguageEntry } = await import("../components/DesignLanguage/LanguageEntry.tsx");
const { markLanguageSet } = await import("../components/DesignLanguage/language-set.ts");
const { PROPOSE_LANGUAGE_PROMPT } = await import("../components/DesignLanguage/agent-prompt.ts");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");

type Design = NonNullable<ReturnType<typeof useCanvas.getState>["design"]>;

function open(design: Partial<Design>, stated = false): void {
  useCanvas.setState({
    design: { boards: [], designName: "velloo", ...design } as unknown as Design,
    languageRules: {
      source: stated ? { path: "guidance.md", writable: true } : null,
      intent: "",
      rules: [],
    },
  });
}

const heading = () => text($("h1"));

/**
 * What an empty design opens to. A new design must be offered the wizard —
 * including one that shares its name with a design whose language was set in
 * this same browser, which is every second design a person makes.
 */
domSuite("design language entry", () => {
  beforeEach(() => localStorage.clear());

  test("a new design is offered the wizard, whatever an earlier design of its name did", async () => {
    markLanguageSet("design-a");
    open({ folderId: "design-b" });
    const view = await mount(<LanguageEntry onNewBoard={() => {}} />);
    try {
      expect(heading()).toBe("Start with a design language");
    } finally {
      await view.unmount();
    }
  });

  test("the design that was taken through the stage says so", async () => {
    markLanguageSet("design-a");
    open({ folderId: "design-a" });
    const view = await mount(<LanguageEntry onNewBoard={() => {}} />);
    try {
      expect(heading()).toBe("Your design language is set");
    } finally {
      await view.unmount();
    }
  });

  test("stated rules are evidence on their own, in any browser", async () => {
    open({ folderId: "design-c" }, true);
    const view = await mount(<LanguageEntry onNewBoard={() => {}} />);
    try {
      expect(heading()).toBe("Your design language is set");
    } finally {
      await view.unmount();
    }
  });

  test("a design with no id borrows no one's hint", async () => {
    markLanguageSet("design-a");
    open({ folderId: null });
    const view = await mount(<LanguageEntry onNewBoard={() => {}} />);
    try {
      expect(heading()).toBe("Start with a design language");
    } finally {
      await view.unmount();
    }
  });
});

/**
 * The two ways to get a language, and what the page does while an agent is
 * off proposing one: it said it would open the proposal when it lands, so it
 * has to tell a proposal landing from rules that were simply already there.
 */
domSuite("getting a design language from the entry page", () => {
  const stated = {
    source: { path: "guidance.md", writable: true },
    intent: "Calm.",
    rules: [{ kind: "do" as const, text: "One accent" }],
  };
  const copied: string[] = [];
  let clipboardWorks = true;
  let server: FakeServer;
  let boardsAsked = 0;
  const views: { unmount(): Promise<void> }[] = [];

  const button = (name: string) =>
    $$("button").find((el) => text(el).startsWith(name)) as HTMLButtonElement;
  const stage = () => {
    const { view, languageMode } = useCanvas.getState();
    return view === "language" ? languageMode : null;
  };

  async function page(): Promise<void> {
    views.push(await mount(<LanguageEntry onNewBoard={() => boardsAsked++} />));
  }

  beforeEach(() => {
    localStorage.clear();
    toasts.length = 0;
    copied.length = 0;
    clipboardWorks = true;
    boardsAsked = 0;
    setApiConnected(true);
    server = serveFolder({ boards: {} });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (!clipboardWorks) throw new Error("denied");
          copied.push(value);
        },
      },
    });
    useCanvas.setState({ view: "boards", currentBoardId: null, boards: {}, theme: null });
  });

  afterEach(async () => {
    for (const view of views.splice(0)) await view.unmount();
    server.restore();
  });

  test("the agent's way hands over the prompt and says the proposal will open here", async () => {
    open({ folderId: "design-a" });
    await page();
    expect($("pre")?.textContent).toBe(PROPOSE_LANGUAGE_PROMPT);
    await interact(() => button("Copy prompt for your agent").click());
    await settle();
    expect(copied).toEqual([PROPOSE_LANGUAGE_PROMPT]);
    expect(toasts).toEqual([
      { kind: "success", message: "Prompt copied — paste it to your coding agent." },
    ]);
    expect(text(document.body)).toContain("opens the proposal on its own when it lands");
  });

  test("a clipboard that refuses says to select the prompt, which is on the page", async () => {
    clipboardWorks = false;
    open({ folderId: "design-a" });
    await page();
    await interact(() => button("Copy prompt for your agent").click());
    await settle();
    expect(toasts).toEqual([
      { kind: "info", message: "Copy failed — select the prompt text instead." },
    ]);
  });

  test("rules appearing while the page is up are the proposal landing: it opens for review", async () => {
    open({ folderId: "design-a" });
    await page();
    expect(stage()).toBeNull();
    server.rules = stated;
    await interact(() => useCanvas.setState({ languageRules: stated }));
    await settle(20);
    expect(stage()).toBe("review");
  });

  test("rules that were there all along are not a proposal", async () => {
    open({ folderId: "design-a" }, true);
    await page();
    await interact(() => useCanvas.setState({ languageRules: { ...stated, intent: "Calmer." } }));
    await settle(20);
    expect(stage()).toBeNull();
  });

  test("nor are rules the page had simply not loaded yet", async () => {
    open({ folderId: "design-a" });
    useCanvas.setState({ languageRules: null });
    await page();
    await interact(() => useCanvas.setState({ languageRules: stated }));
    await settle(20);
    expect(stage()).toBeNull();
    expect(heading()).toBe("Your design language is set");
  });

  test("defining it here walks through the stage one step at a time", async () => {
    open({ folderId: "design-a" });
    await page();
    await interact(() => button("Start").click());
    await settle(20);
    expect(stage()).toBe("guided");
  });

  test("the way out without a language is still there", async () => {
    open({ folderId: "design-a" });
    await page();
    await interact(() => button("Or start with an empty board").click());
    expect(boardsAsked).toBe(1);
    expect(stage()).toBeNull();
  });

  test("once it is set the page offers what comes next, not to start over", async () => {
    open({ folderId: "design-a" }, true);
    await page();
    expect(text(document.body)).not.toContain("Read it from my app");
    await interact(() => button("New board").click());
    expect(boardsAsked).toBe(1);

    await interact(() => button("Copy a prompt for a first screen").click());
    await settle();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toContain("following the design language already set");

    await interact(() => button("Review the design language").click());
    await settle(20);
    expect(stage()).toBe("review");
  });

  test("a stage that could not open is reported", async () => {
    server.fail("/api/design-language");
    open({ folderId: "design-a" });
    await page();
    await interact(() => button("Start").click());
    await settle(20);
    expect(toasts).toEqual([{ kind: "error", message: "Could not open the design language" }]);
  });
});
