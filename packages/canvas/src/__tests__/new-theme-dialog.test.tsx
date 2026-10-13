import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * A new theme is named first, then defined. The dialog's job is the name: say
 * what is wrong with one the way the rest of the app does, and hand a good one
 * to the design-language flow.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const writes: string[] = [];
let refuseWrites = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (init?.method === "POST") {
    writes.push(`${url.pathname} ${String(init.body)}`);
    return refuseWrites ? new Response("unavailable", { status: 500 }) : Response.json({});
  }
  if (url.pathname === "/api/config") return Response.json({ themes: ["default", "Night"] });
  if (url.pathname === "/api/design-language") {
    return Response.json({ rules: { source: null, intent: "", rules: [] }, frameworkRoles: null });
  }
  if (url.pathname === "/api/theme") {
    return Response.json({
      name: url.searchParams.get("name") ?? "default",
      colors: { background: "#fff", foreground: "#111", primary: "#4f46e5" },
      typography: {},
      spacing: {},
      radius: {},
    });
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { NewThemeDialog } = await import("../components/NewThemeDialog.tsx");
const { useCanvas } = await import("../store.ts");

const input = () => $("#new-theme-name") as HTMLInputElement;
const submit = () =>
  $$("button").find((el) => text(el) === "Create and define") as HTMLButtonElement;
const type = (value: string) =>
  interact(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

const dialog = <NewThemeDialog from="default" existing={["default", "Night"]} onClose={() => {}} />;

beforeEach(() => {
  writes.length = 0;
  toasts.length = 0;
  refuseWrites = false;
  useCanvas.setState({ view: "boards", currentBoardId: null, boards: {} });
});

domSuite("new theme dialog", () => {
  test("an empty name is not an error yet, just not enough", async () => {
    const view = await mount(dialog);
    try {
      expect(input().getAttribute("aria-invalid")).toBeNull();
      expect($("[data-slot='field-error']")).toBeNull();
      expect(submit().disabled).toBe(true);
    } finally {
      await view.unmount();
    }
  });

  test("a name that cannot be used marks the field and says why", async () => {
    const view = await mount(dialog);
    try {
      for (const [name, why] of [
        ["night", 'A theme named "Night" already exists.'],
        ["a/b", "Use letters, digits, spaces"],
        ["Default", "already has"],
      ] as const) {
        await type(name);
        expect(input().getAttribute("aria-invalid")).toBe("true");
        expect(text($("[data-slot='field-error']"))).toContain(why);
        expect(submit().disabled).toBe(true);
      }
    } finally {
      await view.unmount();
    }
  });

  test("capitals and spaces are a name, and creating leads into the flow on that theme", async () => {
    const view = await mount(dialog);
    try {
      await type("  Brand   B ");
      expect(input().getAttribute("aria-invalid")).toBeNull();
      expect(text($("[data-slot='field-description']"))).toContain("theme/Brand B.json");
      await interact(() => submit().click());
      await settle(20);
      expect(writes).toEqual(['/api/theme/add_theme {"name":"Brand B","from":"default"}']);
      const state = useCanvas.getState();
      expect([
        state.view,
        state.languageMode,
        state.languageTheme,
        state.languageThemeIsNew,
      ]).toEqual(["language", "guided", "Brand B", true]);
      expect(state.themeName).toBe("Brand B");
    } finally {
      await view.unmount();
    }
  });

  test("a theme that could not be made is reported, and the name can be tried again", async () => {
    let closed = 0;
    refuseWrites = true;
    const view = await mount(
      <NewThemeDialog from="default" existing={["default"]} onClose={() => closed++} />,
    );
    try {
      await type("Brand B");
      await interact(() => submit().click());
      await settle(20);
      expect(toasts).toEqual(["Could not create the theme"]);
      // Still open, on the name that was typed, and no stage was entered for
      // a theme that does not exist.
      expect(closed).toBe(0);
      expect(input().value).toBe("Brand B");
      expect(submit().disabled).toBe(false);
      expect(useCanvas.getState().view).toBe("boards");

      refuseWrites = false;
      await interact(() => submit().click());
      await settle(20);
      expect(closed).toBe(1);
      expect(useCanvas.getState().languageTheme).toBe("Brand B");
    } finally {
      await view.unmount();
    }
  });
});
