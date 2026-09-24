import { afterAll, afterEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import { $, domSuite, type Mounted, mount, settle, text } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * Private and password-protected links are a paid-plan feature. On a free
 * plan the dialog has to show them — so they're discoverable — without letting
 * one through to a publish the cloud will refuse after the upload.
 */

const server = serveFolder({ boards: { main: ["home"], checkout: ["cart"] } });
afterAll(() => server.restore());

const { PublishDialog } = await import("../components/PublishDialog.tsx");
const { useCanvas } = await import("../store.ts");

const signedInOn = (tier: string): AuthStatus => ({
  loggedIn: true,
  verified: true,
  appUrl: "http://localhost:7401",
  login: { state: "idle" },
  account: { email: "dev@example.com", tier },
});

const views: Mounted[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  useCanvas.setState({ publishOpen: false, publishScope: null, authStatus: null, design: null });
  server.publishBlocked = null;
});

async function openDialog(
  tier: string,
  scope: { id: string; name: string; mode: "public" | "private" | "password" } | null = null,
) {
  useCanvas.setState({
    authStatus: signedInOn(tier),
    design: server.design as never,
    publishOpen: true,
    publishScope: scope,
  });
  views.push(await mount(<PublishDialog />));
  // Targets and status load after open; the form only shows once they land.
  await settle(20);
}

domSuite("publish access follows the account's plan", () => {
  test("a free plan shows visibility read-only and an upsell instead of the controls", async () => {
    await openDialog("free");
    const visibility = $("#publish-visibility") as HTMLInputElement | null;
    expect(visibility?.readOnly).toBe(true);
    expect(visibility?.value).toBe("Anyone with the link");
    expect($("#publish-password")).toBeNull();
    const upsell = $('[data-testid="protected-shares-upsell"]');
    expect(text(upsell)).toContain("Private and password-protected links");
    // The cloud's own billing page — this cloud's app, not a hardcoded domain.
    expect(upsell?.querySelector("a")?.getAttribute("href")).toBe("http://localhost:7401/billing");
  });

  test("a board-menu Private on a free plan is offered as public, not refused later", async () => {
    await openDialog("free", { id: "main", name: "Main", mode: "private" });
    expect(text(document.body)).toContain("Sharing “Main” publicly.");
  });

  test("a board-menu Password on a free plan doesn't block Publish on a field it can't fill", async () => {
    await openDialog("free", { id: "main", name: "Main", mode: "password" });
    const publishButton = [...document.querySelectorAll("button")].find(
      (button) => text(button).trim() === "Publish",
    );
    expect(publishButton?.hasAttribute("disabled")).toBe(false);
  });

  test("a paid plan leaves the protected controls alone", async () => {
    await openDialog("team", { id: "main", name: "Main", mode: "private" });
    expect(($("#publish-password") as HTMLInputElement | null)?.disabled).toBe(false);
    expect(text(document.body)).toContain("Sharing “Main” privately.");
    expect($('[data-testid="protected-shares-upsell"]')).toBeNull();
  });
});

const publishButton = () =>
  [...document.querySelectorAll("button")].find((button) => text(button).trim() === "Publish");
const boardBox = (id: string) => $(`#publish-board-${id}`);

domSuite("what the dialog starts with", () => {
  test("the toolbar's Publish ticks no boards, so nothing leaves until someone picks", async () => {
    await openDialog("team");
    expect(boardBox("main")?.getAttribute("aria-checked")).toBe("false");
    expect(boardBox("checkout")?.getAttribute("aria-checked")).toBe("false");
    expect(publishButton()?.hasAttribute("disabled")).toBe(true);
  });

  test("a board menu's Publish ticks that board", async () => {
    await openDialog("team", { id: "checkout", name: "checkout", mode: "public" });
    expect(boardBox("checkout")?.getAttribute("aria-checked")).toBe("true");
    expect(boardBox("main")?.getAttribute("aria-checked")).toBe("false");
    expect(publishButton()?.hasAttribute("disabled")).toBe(false);
  });

  test("an account that can't publish is told why on open, with no form to fill", async () => {
    server.publishBlocked =
      "reviewers can view and comment on boards, but not publish them — to publish, ask an owner or admin to make you a member";
    await openDialog("team");
    expect(text($('[data-testid="publish-blocked"]'))).toBe(
      "Reviewers can view and comment on boards, but not publish them — to publish, ask an owner or admin to make you a member.",
    );
    expect($("#publish-title")).toBeNull();
    expect(publishButton()).toBeUndefined();
  });
});
