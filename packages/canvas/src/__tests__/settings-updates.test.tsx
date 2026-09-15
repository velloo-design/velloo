import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { UpdateStatus } from "../api.ts";
import { $, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * The canvas half of self-update: a new velloo has to be *visible* in the
 * chrome, not only on a terminal someone isn't looking at. What is asserted
 * here is exactly what a person sees — a dot on the account button, an
 * "Upgrade velloo" entry in the menu — and that the entry actually posts.
 */

let status: UpdateStatus;
/** Answer for `?refresh=1` when the cached read should disagree with it. */
let refreshedStatus: UpdateStatus | null = null;
const posted: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (init?.method === "POST") {
    posted.push(url.pathname);
    if (url.pathname === "/api/updates") {
      return Response.json({
        upgraded: true,
        from: status.current,
        to: status.latest,
        restartRequired: true,
      });
    }
    return Response.json({ ok: true });
  }
  if (url.pathname === "/api/updates/status") {
    const refresh = url.searchParams.get("refresh") === "1";
    return Response.json(refresh ? (refreshedStatus ?? status) : status);
  }
  if (url.pathname === "/api/auth/status") {
    return Response.json({ loggedIn: false, verified: null, login: { state: "idle" } });
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { SettingsMenu } = await import("../components/SettingsMenu.tsx");
const { refreshUpdateStatus, compactVersion, startUpdateWatch, __resetUpdateWatch } = await import(
  "../updates.ts"
);

const AVAILABLE: UpdateStatus = {
  current: "0.1.0 (abc · 2026-09-01)",
  latest: "0.2.0 (def · 2026-09-08)",
  available: true,
  method: "npm",
  channel: "stable",
  upgradable: true,
};

beforeEach(() => {
  status = { ...AVAILABLE };
  refreshedStatus = null;
  posted.length = 0;
  __resetUpdateWatch();
  try {
    localStorage.clear();
  } catch {}
});

afterEach(() => {
  __resetUpdateWatch();
});

test("shortens a build stamp to something a menu chip can hold", () => {
  expect(compactVersion("0.2.0")).toBe("0.2.0");
  expect(compactVersion("0.1.0 (ec7210d-dirty · 2026-09-08 14:17)")).toBe(
    "0.1.0 · 2026-09-08 14:17",
  );
  expect(compactVersion("0.1.0 (2026-09-08)")).toBe("0.1.0 · 2026-09-08");
  expect(compactVersion(null)).toBe("");
});

domSuite("account menu update affordances", () => {
  test("marks the trigger and offers the upgrade once a release is pending", async () => {
    const view = await mount(<SettingsMenu />);
    await settle();

    expect($("[data-testid='settings-update-dot']")).not.toBeNull();
    // Radix opens a dropdown on pointerdown, not click.
    await interact(() => {
      const trigger = view.host.querySelector("button") as HTMLElement;
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      trigger.click();
    });
    await settle();

    const item = $("[data-testid='settings-upgrade-velloo']");
    expect(item).not.toBeNull();
    expect(text(item)).toContain("Update velloo");
    // The pending version is what makes the entry actionable rather than a
    // generic "check for updates"; it sits on its own line under the item.
    expect(text(item?.parentElement ?? null)).toContain("0.2.0");

    await interact(() => item?.click());
    await settle();
    expect(posted).toContain("/api/updates");
    await view.unmount();
  });

  test("confirms a stale cached 'up to date' against the release host", async () => {
    // The daemon answers an unrefreshed poll from a cache that can be a whole
    // check interval old — a release cut a minute ago would otherwise go
    // unannounced until the next 15-minute tick.
    status = { ...AVAILABLE, available: false, latest: AVAILABLE.current };
    refreshedStatus = { ...AVAILABLE };
    const view = await mount(<SettingsMenu />);
    await interact(startUpdateWatch);
    await settle();
    expect($("[data-testid='settings-update-dot']")).not.toBeNull();
    expect(localStorage.getItem("velloo:update-toasted")).toBe(AVAILABLE.latest);
    await view.unmount();
  });

  test("stays quiet when velloo is current, or can't upgrade itself", async () => {
    status = { ...AVAILABLE, available: false };
    await refreshUpdateStatus();
    const current = await mount(<SettingsMenu />);
    await settle();
    expect($("[data-testid='settings-update-dot']")).toBeNull();
    await current.unmount();

    // A source checkout has a newer release upstream but nothing velloo may
    // replace, so offering the button would be a dead end.
    __resetUpdateWatch();
    status = { ...AVAILABLE, upgradable: false, reason: "running from source" };
    const source = await mount(<SettingsMenu />);
    await settle();
    expect($("[data-testid='settings-update-dot']")).toBeNull();
    await source.unmount();
  });
});
