import { afterAll, expect, test } from "bun:test";
import { $, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * The balance in the account menu: the coins mark before the number, a colour
 * for how much is left, and a way to Billing to buy more.
 */

let creditMicros = 4_320_000;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/updates/status") {
    return Response.json({ current: "0.1.0", latest: "0.1.0", available: false });
  }
  if (url.pathname === "/api/auth/status") {
    return Response.json({
      loggedIn: true,
      verified: true,
      appUrl: "http://localhost:7401",
      login: { state: "idle" },
      account: { email: "dev@example.com", tier: "free", creditMicros },
    });
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { SettingsMenu } = await import("../components/SettingsMenu.tsx");
const { creditLevel } = await import("../components/Credits.tsx");

test("a balance is plenty above the cloud's low line, low at it, empty under a hundred", () => {
  expect(creditLevel(20_000_000)).toBe("plenty");
  expect(creditLevel(5_000_000)).toBe("low");
  expect(creditLevel(100_000)).toBe("low");
  expect(creditLevel(99_000)).toBe("empty");
  expect(creditLevel(0)).toBe("empty");
});

domSuite("account menu credits", () => {
  const open = async () => {
    const view = await mount(<SettingsMenu />);
    await settle();
    await interact(() => {
      const trigger = view.host.querySelector("button") as HTMLElement;
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      trigger.click();
    });
    await settle();
    return view;
  };

  test("the balance links to Billing, with the coins before a coloured number", async () => {
    creditMicros = 4_320_000;
    const view = await open();
    const row = $("[data-testid='settings-credits']") as HTMLAnchorElement;
    expect(row.tagName).toBe("A");
    expect(row.href).toBe("http://localhost:7401/billing");
    expect(text(row)).toContain("4,320");
    expect(row.querySelector(".lucide-coins")).not.toBeNull();
    expect(row.querySelector(".text-amber-600\\!")).not.toBeNull();
    await view.unmount();
  });

  test("Upgrade plan comes after Show tips again", async () => {
    creditMicros = 40_000_000;
    const view = await open();
    const items = [...document.querySelectorAll("[data-testid]")].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(items.indexOf("settings-upgrade")).toBeGreaterThan(items.indexOf("settings-hints"));
    expect($("[data-testid='settings-credits'] .text-emerald-600\\!")).not.toBeNull();
    await view.unmount();
  });
});
