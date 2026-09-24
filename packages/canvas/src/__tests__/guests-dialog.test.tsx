import { afterAll, afterEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import type { PublishedBoard, PublishGuest } from "../api/publish.ts";
import { $, $$, domSuite, interact, type Mounted, mount, settle, text, typeInto } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * Sharing a board with people outside the organization, from the canvas: the
 * board menu's one Publish entry, the guests dialog behind a published board,
 * and the way into it from a fresh publish.
 */

const server = serveFolder({ boards: { main: ["home"] } });
afterAll(() => server.restore());

const { GuestsDialog } = await import("../components/GuestsDialog.tsx");
const { PublishedBoardsDialog } = await import("../components/PublishedBoardsDialog.tsx");
const { PublishDone } = await import("../components/Publish/PublishOutcome.tsx");
const { BoardRow } = await import("../components/BoardsSidebar/BoardRow.tsx");
const { useCanvas } = await import("../store.ts");

const signedInOn = (tier: string): AuthStatus => ({
  loggedIn: true,
  verified: true,
  appUrl: "http://localhost:7401",
  login: { state: "idle" },
  account: { email: "dev@example.com", tier },
});

const ada: PublishGuest = {
  id: "g1",
  name: "Ada",
  email: "ada@client.example",
  createdAt: "2030-01-01T00:00:00.000Z",
  lastSeenAt: null,
  linkExpiresAt: null,
};

const views: Mounted[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  useCanvas.setState({
    guestsBoard: null,
    publishedBoardsOpen: false,
    publishOpen: false,
    publishScope: null,
    authStatus: null,
  });
  server.guests = {};
  server.guestEmail = true;
  server.guestCalls.length = 0;
  server.publishedBoards = [];
});

async function openGuests(tier: string) {
  useCanvas.setState({
    authStatus: signedInOn(tier),
    guestsBoard: { slug: "review", title: "Checkout review" },
  });
  views.push(await mount(<GuestsDialog />));
  await settle(10);
}

const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => text(b).trim() === label);

/** Open a guest's 3-dot menu and pick an item. */
async function guestAction(guest: string, item: string) {
  await interact(() => {
    const trigger = $(`[aria-label="Actions for ${guest}"]`) as HTMLElement;
    trigger.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
    trigger.click();
  });
  await settle();
  const entry = $$('[role="menuitem"]').find((el) => text(el) === item);
  if (!entry) throw new Error(`no "${item}" in ${guest}'s menu`);
  await interact(() => entry.click());
  await settle(10);
}

domSuite("the board menu", () => {
  test("offers one Publish… that opens the dialog with the board ticked", async () => {
    useCanvas.setState({ wsConnected: true, publishSlots: [] });
    views.push(
      await mount(
        <BoardRow
          board={{ id: "main", name: "Main", frameCount: 1 }}
          active={false}
          groups={[]}
          drag={{
            draggable: false,
            dragging: false,
            onDragStart: () => {},
            onDragOver: () => {},
            onDragEnd: () => {},
          }}
          onRename={() => {}}
          onAddFrame={() => {}}
          onMoveToGroup={() => {}}
          onNewGroup={() => {}}
          onArchive={() => {}}
          onDelete={() => {}}
        />,
      ),
    );
    await interact(() => {
      const trigger = $('[title="Board menu"]') as HTMLElement;
      trigger.dispatchEvent(
        new window.PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      );
      trigger.click();
    });
    await settle();

    const items = $$('[role="menuitem"]').map((el) => text(el));
    expect(items).toContain("Publish…");
    // No access submenu: who can see the link is the dialog's question.
    expect(items.some((item) => /^(Public|Private|Password protected)/.test(item))).toBe(false);

    await interact(() => $('[data-testid="board-publish"]')?.click());
    expect(useCanvas.getState().publishOpen).toBe(true);
    expect(useCanvas.getState().publishScope).toEqual({ id: "main", name: "Main" });
  });
});

domSuite("a board's guests", () => {
  test("lists who it is shared with, and whether they've opened it", async () => {
    server.guests.review = [ada, { ...ada, id: "g2", name: null, email: "bo@client.example" }];
    await openGuests("team");
    const rows = $$('[data-testid="guests-list"] li');
    expect(rows).toHaveLength(2);
    expect(text(rows[0] ?? null)).toContain("Ada");
    expect(text(rows[0] ?? null)).toContain("ada@client.example · Not opened yet");
    expect(text(rows[1] ?? null)).toContain("bo@client.example");
  });

  test("an invite adds the guest and says the email is on its way", async () => {
    await openGuests("team");
    expect(text(document.body)).toContain("No guests yet");
    await interact(() => typeInto($("#guest-email") as HTMLInputElement, " ada@client.example "));
    await interact(() => typeInto($("#guest-name") as HTMLInputElement, "Ada"));
    await interact(() => button("Invite")?.click());
    await settle(10);
    expect(server.guestCalls).toEqual(["invite review ada@client.example"]);
    expect(text($('[data-testid="guests-list"]'))).toContain("Ada");
    expect(($("#guest-email") as HTMLInputElement).value).toBe("");
    // Emailed, so there is no link to hand over.
    expect($('[data-testid="guest-handover"]')).toBeNull();
  });

  // Email off (a dev cloud, say): the link is the only way the guest gets in.
  test("an invite that couldn't be emailed shows the link to copy", async () => {
    server.guestEmail = false;
    await openGuests("team");
    await interact(() => typeInto($("#guest-email") as HTMLInputElement, "ada@client.example"));
    await interact(() => button("Invite")?.click());
    await settle(10);
    const handover = $('[data-testid="guest-handover"]');
    expect(text(handover)).toContain("send this link yourself");
    expect((handover?.querySelector("input") as HTMLInputElement | null)?.value).toContain(
      "https://share.velloo.dev/s/review/guest?t=g1",
    );
    expect($('[aria-label="Copy guest link"]')).not.toBeNull();
  });

  test("a new link to copy says the old one stops working", async () => {
    server.guests.review = [ada];
    await openGuests("team");
    await guestAction("Ada", "Copy a new link");
    expect(server.guestCalls).toEqual(["link review g1"]);
    const handover = $('[data-testid="guest-handover"]');
    expect(text(handover)).toContain("The link they had before no longer works.");
    expect((handover?.querySelector("input") as HTMLInputElement | null)?.value).toContain("t=g1");
  });

  test("resend emails a fresh link", async () => {
    server.guests.review = [ada];
    await openGuests("team");
    await guestAction("Ada", "Email a new link");
    expect(server.guestCalls).toEqual(["resend review g1"]);
  });

  test("removing a guest confirms first, then drops them", async () => {
    server.guests.review = [ada];
    await openGuests("team");
    await guestAction("Ada", "Remove");
    expect(server.guestCalls).toEqual([]);
    expect(text(document.body)).toContain("Remove Ada?");
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => text(b) === "Remove",
    ) as HTMLElement;
    await interact(() => confirm.click());
    await settle(10);
    expect(server.guestCalls).toEqual(["delete review g1"]);
    expect(server.guests.review).toEqual([]);
    expect(text(document.body)).toContain("No guests yet");
  });

  test("a free plan sees the offer and the way up, with nothing to fill in", async () => {
    await openGuests("free");
    const upsell = $('[data-testid="guests-upsell"]');
    expect(text(upsell)).toContain("Upgrade your plan to invite guests");
    // Plans are the billing page's to name.
    expect(text(upsell)).not.toMatch(/\b(Team|Business)\b/);
    expect(upsell?.querySelector("a")?.getAttribute("href")).toBe("http://localhost:7401/billing");
    expect(($("#guest-email") as HTMLInputElement).disabled).toBe(true);
    expect(button("Invite")?.hasAttribute("disabled")).toBe(true);
  });
});

const published = (over: Partial<PublishedBoard> = {}): PublishedBoard => ({
  slug: "review",
  title: "Checkout review",
  url: "https://share.velloo.dev/s/review/",
  visibility: "public",
  passwordProtected: false,
  canManage: true,
  lastPublishedAt: new Date().toISOString(),
  ...over,
});

domSuite("ways into a board's guests", () => {
  test("a managed published board opens its guests; a teammate's does not", async () => {
    server.publishedBoards = [
      published({ guestCount: 2 }),
      published({ slug: "other", title: "Other", canManage: false }),
    ];
    useCanvas.setState({ authStatus: signedInOn("team"), publishedBoardsOpen: true });
    views.push(await mount(<PublishedBoardsDialog />));
    await settle(10);
    expect(text($('[data-testid="published-boards-list"] li'))).toContain("2 guests");
    expect(($('[aria-label="Guests on Other"]') as HTMLButtonElement).disabled).toBe(true);

    await interact(() => $('[aria-label="Guests on Checkout review"]')?.click());
    expect(useCanvas.getState().guestsBoard).toEqual({ slug: "review", title: "Checkout review" });
    expect(useCanvas.getState().publishedBoardsOpen).toBe(false);
  });

  test("a team-only board is named for its team, not the whole organization", async () => {
    server.publishedBoards = [
      published({ visibility: "private", onlyTeam: "Brand" }),
      published({ slug: "org", title: "Org", visibility: "private" }),
    ];
    useCanvas.setState({ authStatus: signedInOn("business"), publishedBoardsOpen: true });
    views.push(await mount(<PublishedBoardsDialog />));
    await settle(10);
    const rows = [...document.querySelectorAll('[data-testid="published-boards-list"] li')];
    expect(text(rows[0] ?? null)).toContain("Only Brand");
    expect(text(rows[1] ?? null)).toContain("Your organization");
  });

  test("a fresh publish offers to invite guests", async () => {
    let invited = false;
    const done = {
      state: "done" as const,
      warnings: [],
      finishedAt: new Date().toISOString(),
      result: {
        shareUrl: "https://share.velloo.dev/s/review/",
        slug: "review",
        visibility: "private" as const,
        passwordProtected: false,
        onlyTeam: "Brand",
        files: 3,
        bytes: 2048,
        screenshots: 0,
        boards: 1,
        screens: 1,
        created: true,
      },
    };
    views.push(
      await mount(
        <PublishDone
          run={done}
          upgradeUrl={null}
          onInviteGuests={() => {
            invited = true;
          }}
        />,
      ),
    );
    expect(text(document.body)).toContain("Brand, plus your organization's owner and admins.");
    await interact(() => $('[data-testid="publish-invite-guests"]')?.click());
    expect(invited).toBe(true);

    await views.pop()?.unmount();
    views.push(await mount(<PublishDone run={done} upgradeUrl={null} onInviteGuests={null} />));
    expect($('[data-testid="publish-invite-guests"]')).toBeNull();
  });
});
