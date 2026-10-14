import { afterEach, beforeEach, expect, test } from "bun:test";
import { $, domSuite, interact, mount, settle, typeInto } from "./dom.ts";
import { type FakeServer, serveFolder } from "./fake-server.ts";

/**
 * A theme colour: the swatch, its value as text, and the wheel. Someone who
 * clicks into the value is choosing a colour as much as someone who clicks the
 * swatch, so the wheel comes up for both — beside the field, never on top of
 * the typing. And the two are one value: a colour typed beside the wheel moves
 * the wheel, and one picked in the wheel is what gets written.
 */

const { ColorSwatch } = await import("../components/ColorSwatch.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { normalizeToOklch } = await import("../color.ts");

/** A swatch's write is debounced; this is past it. */
const WRITTEN = 320;

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

async function swatch(value = "#4f46e5") {
  const view = await mount(
    <ColorSwatch label="Primary" tokenPath="colors.primary" value={value} />,
  );
  views.push(view);
  return view;
}

const field = () => document.getElementById("token-colors.primary") as HTMLInputElement;
const chip = () => $("button[aria-label='Edit Primary']") as HTMLButtonElement;
const wheel = () => $("[role='application']");
const hex = () => $("#velloo-color-hex") as HTMLInputElement | null;
const oklch = () => $("#velloo-color-oklch") as HTMLInputElement | null;
const written = () => server.themeWrites.map((w) => (w.args as { value: string }).value);

beforeEach(() => {
  server = serveFolder();
  setApiConnected(true);
  useCanvas.setState({ themeName: "default" });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.restore();
});

domSuite("a theme colour", () => {
  test("the wheel is closed until asked for", async () => {
    await swatch();
    expect(wheel()).toBeNull();
    expect(chip().style.background).toBe("#4f46e5");
    expect(chip().getAttribute("title")).toBe("colors.primary — click to edit");
  });

  test("focusing the value brings the wheel up without taking the caret", async () => {
    await swatch();
    await interact(() => field().focus());
    await settle();
    expect(wheel()).not.toBeNull();
    expect(hex()?.value).toBe("#4f46e5");
    // Typing must still land in the field that was clicked into.
    expect(document.activeElement).toBe(field());
  });

  test("a colour typed beside the open wheel moves the wheel to it", async () => {
    await swatch();
    await interact(() => field().focus());
    await settle();
    await interact(() => typeInto(field(), "#ff0000"));
    expect(hex()?.value).toBe("#ff0000");
    expect(oklch()?.value).toBe(normalizeToOklch("#ff0000") as string);
  });

  test("a colour set in the wheel's own fields is what gets written, as OKLCH", async () => {
    await swatch();
    await interact(() => chip().click());
    await settle();
    await interact(() => typeInto(hex() as HTMLInputElement, "#00ff00"));
    // The field beside the wheel shows what the theme will hold.
    expect(field().value).toBe(normalizeToOklch("#00ff00") as string);
    await settle(WRITTEN);
    expect(server.themeWrites).toEqual([
      {
        op: "set_token",
        args: { path: "colors.primary", value: normalizeToOklch("#00ff00"), theme: "default" },
      },
    ]);
  });

  test("half a hex in the wheel is kept as typed and writes nothing", async () => {
    await swatch();
    await interact(() => chip().click());
    await settle();
    await interact(() => typeInto(hex() as HTMLInputElement, "#0"));
    await settle(WRITTEN);
    expect(hex()?.value).toBe("#0");
    expect(field().value).toBe("#4f46e5");
    expect(server.themeWrites).toEqual([]);
  });

  test("a value that is not a colour to parse is saved as typed", async () => {
    await swatch();
    await interact(() => typeInto(field(), "var(--brand)"));
    await settle(WRITTEN);
    expect(written()).toEqual(["var(--brand)"]);
  });

  test("the theme changing underneath replaces what the field shows", async () => {
    const view = await swatch();
    await view.render(<ColorSwatch label="Primary" tokenPath="colors.primary" value="#0ea5e9" />);
    expect(field().value).toBe("#0ea5e9");
    expect(chip().style.background).toBe("#0ea5e9");
  });
});
