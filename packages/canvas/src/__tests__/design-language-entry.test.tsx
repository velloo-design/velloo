import { beforeEach, expect, test } from "bun:test";
import { $, domSuite, mount, text } from "./dom.ts";

const { LanguageEntry } = await import("../components/DesignLanguage/LanguageEntry.tsx");
const { markLanguageSet } = await import("../components/DesignLanguage/language-set.ts");
const { useCanvas } = await import("../store.ts");

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
