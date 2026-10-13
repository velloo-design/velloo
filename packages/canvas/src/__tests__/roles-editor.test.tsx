import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { Theme } from "@velloo/schema";
import { $$, domSuite, interact, mount, press, settle, text, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * The colour roles, as the stage and the Theme rail both edit them. Three
 * things here are easy to get quietly wrong: which palette an edit lands in,
 * that a dark pair which does not exist yet is written whole rather than one
 * half at a time, and that a role of the design's own gets both of its values
 * from the start.
 */

const toasts: string[] = [];
mock.module("../toast.ts", () => ({
  pushToast: () => "toast",
  toastError: (_err: unknown, fallback: string) => {
    toasts.push(fallback);
    return "toast";
  },
}));

const { RolesEditor } = await import("../components/DesignLanguage/RolesEditor.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { normalizeToOklch } = await import("../color.ts");

const theme = (over: Partial<Theme> = {}): Theme =>
  ({
    name: "default",
    colors: {
      background: "#ffffff",
      foreground: "#111111",
      primary: { DEFAULT: "#4f46e5", foreground: "#fafafa" },
      accent: "#f59e0b",
      ring: "#93c5fd",
    },
    typography: {},
    spacing: {},
    radius: {},
    ...over,
  }) as unknown as Theme;

/** A swatch's own write is debounced; this is past it. */
const WRITTEN = 320;

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];
const schemes: string[] = [];

async function edit(subject: Theme, scheme: "light" | "dark" = "light", themeName = "default") {
  useCanvas.setState({ themeName });
  const view = await mount(
    <RolesEditor theme={subject} scheme={scheme} onSchemeChange={(next) => schemes.push(next)} />,
  );
  views.push(view);
  return view;
}

const swatch = (tokenPath: string) =>
  document.getElementById(`token-${tokenPath}`) as HTMLInputElement | null;
const swatchLabels = (root: ParentNode = document) =>
  [...root.querySelectorAll("label[for^='token-']")].map((el) => text(el));
/** The swatches under one of the editor's headings. */
const group = (heading: string) => {
  const field = $$("[data-slot='field']").find((el) => text(el).startsWith(heading));
  return field ? swatchLabels(field) : null;
};
const newRole = () => document.getElementById("language-custom-role") as HTMLInputElement;
const addButton = () => $$("button[aria-label='Add custom role']")[0] as HTMLButtonElement;

async function recolour(tokenPath: string, value: string): Promise<void> {
  await interact(() => typeInto(swatch(tokenPath) as HTMLInputElement, value));
  await settle(WRITTEN);
}

beforeEach(() => {
  toasts.length = 0;
  schemes.length = 0;
  server = serveFolder();
  setApiConnected(true);
  useCanvas.setState({ design: server.design as never, frameworkRoles: null });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("which palette an edit lands in", () => {
  test("a light role is written to the theme's colours, stored as OKLCH", async () => {
    await edit(theme());
    await recolour("colors.background", "#ff0000");
    expect(server.themeWrites).toEqual([
      {
        op: "set_token",
        args: { path: "colors.background", value: normalizeToOklch("#ff0000"), theme: "default" },
      },
    ]);
  });

  test("the write goes to the theme being edited, not the default", async () => {
    await edit(theme(), "light", "Night");
    await recolour("colors.primary.foreground", "#000000");
    expect(server.themeWrites[0]?.args).toMatchObject({
      path: "colors.primary.foreground",
      theme: "Night",
    });
  });

  test("keystrokes on the way to a colour are one write, of where they ended", async () => {
    await edit(theme());
    for (const partial of ["#f", "#ff0", "#ff0000"]) {
      await interact(() => typeInto(swatch("colors.background") as HTMLInputElement, partial));
    }
    await settle(WRITTEN);
    expect(server.themeWrites.map((w) => (w.args as { value: string }).value)).toEqual([
      normalizeToOklch("#ff0000") as string,
    ]);
  });

  test("the switch asks whoever owns the preview to change palette", async () => {
    await edit(theme());
    await interact(() =>
      $$("[role='radio']")
        .find((el) => text(el) === "Dark")
        ?.click(),
    );
    expect(schemes).toEqual(["dark"]);
  });

  test("dark with no dark palette shows the light colours and says so", async () => {
    await edit(theme(), "dark");
    expect(text(document.body)).toContain("no dark palette yet, so dark shows the light colours");
    expect(swatch("colorsDark.background")?.value).toBe("#ffffff");
  });

  test("a dark role that is a single colour becomes the first dark colour on its own", async () => {
    await edit(theme(), "dark");
    await recolour("colorsDark.background", "#000000");
    expect(server.themeWrites).toEqual([
      {
        op: "set_token",
        args: {
          path: "colorsDark.background",
          value: normalizeToOklch("#000000"),
          theme: "default",
        },
      },
    ]);
  });
});

domSuite("a dark pair that does not exist yet", () => {
  test("changing its colour writes the pair whole, with the foreground it resolved to", async () => {
    await edit(theme(), "dark");
    await recolour("colorsDark.primary.DEFAULT", "#818cf8");
    // `{ DEFAULT }` alone would leave the dark pair without its foreground.
    expect(server.themeWrites).toEqual([
      {
        op: "set_tokens",
        args: {
          entries: [
            { path: "colorsDark.primary.DEFAULT", value: normalizeToOklch("#818cf8") },
            { path: "colorsDark.primary.foreground", value: "#fafafa" },
          ],
          theme: "default",
        },
      },
    ]);
  });

  test("changing its foreground writes the pair whole, with the colour it resolved to", async () => {
    await edit(theme(), "dark");
    await recolour("colorsDark.primary.foreground", "#000000");
    expect(server.themeWrites[0]).toEqual({
      op: "set_tokens",
      args: {
        entries: [
          { path: "colorsDark.primary.DEFAULT", value: "#4f46e5" },
          { path: "colorsDark.primary.foreground", value: normalizeToOklch("#000000") },
        ],
        theme: "default",
      },
    });
  });

  test("once the dark pair exists, each half is its own write", async () => {
    const dark = theme({
      colorsDark: { primary: { DEFAULT: "#818cf8", foreground: "#0b0b0b" } },
    } as Partial<Theme>);
    await edit(dark, "dark");
    expect(swatch("colorsDark.primary.DEFAULT")?.value).toBe("#818cf8");
    await recolour("colorsDark.primary.foreground", "#ffffff");
    expect(server.themeWrites).toEqual([
      {
        op: "set_token",
        args: {
          path: "colorsDark.primary.foreground",
          value: normalizeToOklch("#ffffff"),
          theme: "default",
        },
      },
    ]);
  });
});

domSuite("the roles a framework reads", () => {
  test("a framework that does not say gets one list", async () => {
    await edit(theme());
    expect(group("Used by")).toBeNull();
    expect(swatchLabels().slice(0, 6)).toEqual([
      "Background",
      "Foreground",
      "Primary",
      "Primary fg",
      "Accent",
      "Ring",
    ]);
  });

  test("the slots its components read lead, and the rest are still offered", async () => {
    useCanvas.setState({
      design: { ...server.design, providerId: "mui" } as never,
      frameworkRoles: ["background", "foreground", "primary"],
    });
    await edit(theme());
    expect(group("Used by Material UI's components")).toEqual([
      "Background",
      "Foreground",
      "Primary",
      "Primary fg",
    ]);
    expect(group("For your own designs")).toEqual(["Accent", "Ring"]);
  });

  test("a framework that reads every slot has no leftovers to explain", async () => {
    useCanvas.setState({
      design: { ...server.design, providerId: "shadcn-upstream" } as never,
      frameworkRoles: [
        "background",
        "foreground",
        "primary",
        "secondary",
        "muted",
        "accent",
        "destructive",
        "card",
        "popover",
        "border",
        "input",
        "ring",
      ],
    });
    await edit(theme());
    expect(group("Used by shadcn's components")).toHaveLength(6);
    expect(group("For your own designs")).toBeNull();
  });
});

domSuite("roles of the design's own", () => {
  const withRoles = () =>
    theme({
      // `primary-600` is a step of an imported scale, not a role someone named.
      palette: { success: "#16a34a", "brand-soft": "#eef2ff", "primary-600": "#4338ca" },
      paletteDark: { success: "#22c55e" },
    } as Partial<Theme>);

  test("the named ones are listed; an imported scale's steps are not", async () => {
    await edit(withRoles());
    expect(group("Custom roles")).toEqual(["brand-soft", "success"]);
  });

  test("each has a dark value, which is its light one until it is given its own", async () => {
    await edit(withRoles(), "dark");
    expect(swatch("paletteDark.success")?.value).toBe("#22c55e");
    expect(swatch("paletteDark.brand-soft")?.value).toBe("#eef2ff");
  });

  test("a name is stored as a token: typed loosely, saved as an identifier, light and dark at once", async () => {
    await edit(withRoles(), "light", "Night");
    await interact(() => typeInto(newRole(), "  Brand Loud! "));
    await interact(() => press(newRole(), "Enter"));
    await settle();
    // Both values start from the primary, so the role is usable in either palette at once.
    expect(server.themeWrites).toEqual([
      {
        op: "set_role",
        args: { name: "brand-loud", light: "#4f46e5", dark: "#4f46e5", theme: "Night" },
      },
    ]);
    expect(newRole().value).toBe("");
  });

  test("the button adds it too", async () => {
    await edit(theme({ colors: { ...theme().colors, primary: "#0ea5e9" } } as Partial<Theme>));
    await interact(() => typeInto(newRole(), "tertiary"));
    await interact(() => addButton().click());
    await settle();
    expect(server.themeWrites[0]?.args).toEqual({
      name: "tertiary",
      light: "#0ea5e9",
      dark: "#0ea5e9",
      theme: "default",
    });
  });

  test("a name with nothing in it that could be a token is not offered", async () => {
    await edit(theme());
    expect(addButton().disabled).toBe(true);
    await interact(() => typeInto(newRole(), " -- !! "));
    expect(addButton().disabled).toBe(true);
    await interact(() => press(newRole(), "Enter"));
    await settle();
    expect(server.themeWrites).toEqual([]);
  });

  test("removing one removes both of its values in one write", async () => {
    await edit(withRoles());
    await interact(() =>
      ($$("button[aria-label='Remove the success role']")[0] as HTMLButtonElement).click(),
    );
    await settle();
    expect(server.themeWrites).toEqual([
      { op: "set_role", args: { name: "success", remove: true, theme: "default" } },
    ]);
  });

  test("a role the server refuses is reported, not swallowed", async () => {
    server.fail("/api/theme/set_role");
    await edit(withRoles());
    await interact(() => typeInto(newRole(), "tertiary"));
    await interact(() => press(newRole(), "Enter"));
    await settle();
    await interact(() =>
      ($$("button[aria-label='Remove the success role']")[0] as HTMLButtonElement).click(),
    );
    await settle();
    expect(toasts).toEqual(["Could not add the role", "Could not remove the role"]);
  });
});
