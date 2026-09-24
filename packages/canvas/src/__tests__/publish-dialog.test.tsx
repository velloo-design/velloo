import { afterAll, afterEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import type { PublishSlot } from "../api/publish.ts";
import { $, $$, domSuite, interact, type Mounted, mount, settle, text, typeInto } from "./dom.ts";
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
  useCanvas.setState({
    publishOpen: false,
    publishScope: null,
    guestsBoard: null,
    authStatus: null,
    design: null,
  });
  server.publishBlocked = null;
  server.publishTeams = [];
  server.publishSlots = [];
  server.publishRequests.length = 0;
});

async function openDialog(tier: string, scope: { id: string; name: string } | null = null) {
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
    expect(visibility?.value).toBe("Public — anyone with the link");
    expect($("#publish-password")).toBeNull();
    const upsell = $('[data-testid="protected-shares-upsell"]');
    expect(text(upsell)).toContain("Private and password-protected links");
    // The cloud's own billing page — this cloud's app, not a hardcoded domain.
    expect(upsell?.querySelector("a")?.getAttribute("href")).toBe("http://localhost:7401/billing");
  });

  test("a paid plan leaves the protected controls alone", async () => {
    await openDialog("team", { id: "main", name: "Main" });
    expect(($("#publish-password") as HTMLInputElement | null)?.disabled).toBe(false);
    expect(text(document.body)).toContain("“Main”");
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
    await openDialog("team", { id: "checkout", name: "checkout" });
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

/** Open a Radix select and pick the option whose text starts with `label`. */
async function choose(trigger: string, label: string) {
  await interact(() => ($(trigger) as HTMLElement | null)?.click());
  await settle();
  const option = $$('[role="option"]').find((el) => text(el).startsWith(label));
  if (!option) throw new Error(`no option "${label}" in ${trigger}`);
  await interact(() => option.click());
  await settle();
}

async function optionsOf(trigger: string): Promise<string[]> {
  await interact(() => ($(trigger) as HTMLElement | null)?.click());
  await settle();
  const options = $$('[role="option"]').map((el) => text(el));
  await interact(() => {
    document.activeElement?.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await settle();
  return options;
}

async function publishNow() {
  await interact(() => publishButton()?.click());
  await settle(20);
  return server.publishRequests.at(-1);
}

const TEAMS = [
  { id: "t1", name: "Design", isDefault: true },
  { id: "t2", name: "Brand" },
];

domSuite("who can open the link", () => {
  test("the options use the CLI's words", async () => {
    await openDialog("team", { id: "main", name: "main" });
    expect(text($("#publish-visibility"))).toBe("Public — anyone with the link");
    expect(await optionsOf("#publish-visibility")).toEqual([
      "Public — anyone with the link",
      "Private — everyone in your organization",
    ]);
  });

  test("with several teams on a plan that has it, team-only is offered for the chosen team", async () => {
    server.publishTeams = TEAMS;
    await openDialog("business", { id: "main", name: "main" });
    expect(await optionsOf("#publish-visibility")).toContain(
      "Only Design — that team, plus your organization's owner and admins",
    );

    // The label follows the Team select rather than naming the team it opened on.
    await choose("#publish-team", "Brand");
    await choose("#publish-visibility", "Only Brand");
    expect(text($("#publish-visibility"))).toBe(
      "Only Brand — that team, plus your organization's owner and admins",
    );

    expect(await publishNow()).toMatchObject({
      boardIds: ["main"],
      visibility: "private",
      teamOnly: true,
      teamId: "t2",
    });
  });

  test("team-only needs more than one team, and a plan that has it", async () => {
    server.publishTeams = [TEAMS[0] as (typeof TEAMS)[number]];
    await openDialog("business", { id: "main", name: "main" });
    expect((await optionsOf("#publish-visibility")).some((o) => o.startsWith("Only"))).toBe(false);
    await views.pop()?.unmount();

    server.publishTeams = TEAMS;
    await openDialog("team", { id: "main", name: "main" });
    expect((await optionsOf("#publish-visibility")).some((o) => o.startsWith("Only"))).toBe(false);
  });

  test("an organization-wide private link goes out without a team audience", async () => {
    server.publishTeams = TEAMS;
    await openDialog("business", { id: "main", name: "main" });
    await choose("#publish-visibility", "Private");
    const sent = await publishNow();
    expect(sent).toMatchObject({ visibility: "private", teamId: "t1" });
    expect(sent?.teamOnly).toBeUndefined();
  });
});

const commentsSwitch = () => $("#publish-public-comments");

domSuite("letting people outside the organization comment", () => {
  test("a public link offers it — on every plan — and a new link sends it, off by default", async () => {
    await openDialog("free", { id: "main", name: "main" });
    expect(commentsSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(text(document.body)).toContain("Let people outside your organization comment");
    expect((await publishNow())?.publicComments).toBe(false);
  });

  test("switched on, it travels with the publish", async () => {
    await openDialog("team", { id: "main", name: "main" });
    await interact(() => commentsSwitch()?.click());
    expect((await publishNow())?.publicComments).toBe(true);
  });

  test("a private link hides it and sends nothing — unless a password lets outsiders in", async () => {
    await openDialog("team", { id: "main", name: "main" });
    await choose("#publish-visibility", "Private");
    expect(commentsSwitch()).toBeNull();

    await interact(() => typeInto($("#publish-password") as HTMLInputElement, "hunter2"));
    expect(commentsSwitch()).not.toBeNull();
    await interact(() => typeInto($("#publish-password") as HTMLInputElement, ""));
    expect(commentsSwitch()).toBeNull();

    expect((await publishNow())?.publicComments).toBeUndefined();
  });

  // The destinations don't say what an existing link allows, so sending the
  // switch's default would quietly turn commenting off on a link that had it.
  test("updating a link leaves its setting alone unless the switch is touched", async () => {
    const existing: PublishSlot = {
      slug: "review",
      url: "https://share.velloo.dev/s/review/",
      title: "Review",
      teamId: null,
      latestVersionId: "11111111-1111-4111-8111-111111111111",
      lastPublishedAt: "2030-01-01T00:00:00.000Z",
      context: { boardIds: ["main"], contextKnown: true, repo: null, branch: null },
    };
    server.publishSlots = [existing];
    await openDialog("team", { id: "main", name: "main" });
    expect(text($("#publish-destination"))).toBe("Update Review");
    expect(text(document.body)).toContain("the link keeps its current setting");
    const untouched = await publishNow();
    expect(untouched?.destination).toMatchObject({ mode: "update", slug: "review" });
    expect(untouched?.publicComments).toBeUndefined();

    await views.pop()?.unmount();
    useCanvas.setState({ publishOpen: false });
    await openDialog("team", { id: "main", name: "main" });
    await interact(() => commentsSwitch()?.click());
    await interact(() => commentsSwitch()?.click());
    expect((await publishNow())?.publicComments).toBe(false);
  });
});
