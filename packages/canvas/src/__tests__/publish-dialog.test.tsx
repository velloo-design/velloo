import { afterAll, afterEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import { $, domSuite, type Mounted, mount, settle, text } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * Private and password-protected links are a paid-plan feature. On a free
 * plan the dialog has to show them — so they're discoverable — without letting
 * one through to a publish the cloud will refuse after the upload.
 */

const server = serveFolder();
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
  useCanvas.setState({ publishOpen: false, publishScope: null, authStatus: null });
});

async function openDialog(
  tier: string,
  scope: { id: string; name: string; mode: "public" | "private" | "password" } | null = null,
) {
  useCanvas.setState({ authStatus: signedInOn(tier), publishOpen: true, publishScope: scope });
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
