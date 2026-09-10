import { afterAll, afterEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import type { PublishedBoard, PublishSlot } from "../api/publish.ts";
import { $, $$, domSuite, interact, type Mounted, mount, settle, text } from "./dom.ts";
import { serveFolder } from "./fake-server.ts";

/**
 * Publishing used to be one-way from the canvas: the board menu minted links
 * and no surface ever showed them again — which is also why the plan's board
 * cap was unanswerable from the dialog that hit it. These cover the two ways
 * back: a board row that points at its own latest publish, and the manager
 * that can take one down.
 */

const server = serveFolder();
afterAll(() => server.restore());

const { PublishedBoardsDialog, publishedBoardsUrl, publishedWhen } = await import(
  "../components/PublishedBoardsDialog.tsx"
);
const { latestPublishForBoard, useCanvas } = await import("../store.ts");

const signedIn: AuthStatus = {
  loggedIn: true,
  verified: true,
  appUrl: "http://localhost:7401",
  login: { state: "idle" },
  account: { email: "dev@example.com", tier: "free" },
};

const slot = ({
  boardIds,
  ...over
}: Partial<PublishSlot> & { boardIds: string[] }): PublishSlot => ({
  slug: "review",
  url: "https://share.velloo.dev/s/review/",
  title: "Review",
  teamId: null,
  latestVersionId: "11111111-1111-4111-8111-111111111111",
  lastPublishedAt: "2030-01-01T00:00:00.000Z",
  ...over,
  context: { boardIds, contextKnown: true, repo: null, branch: null },
});

const published = (over: Partial<PublishedBoard> = {}): PublishedBoard => ({
  slug: "checkout-review",
  title: "Checkout review",
  url: "https://share.velloo.dev/s/checkout-review/",
  visibility: "public",
  passwordProtected: false,
  canManage: true,
  lastPublishedAt: new Date().toISOString(),
  ...over,
});

test("a board's latest publish is the newest link that actually shipped one", () => {
  const older = slot({ slug: "old", boardIds: ["home"], lastPublishedAt: "2029-01-01T00:00:00Z" });
  const newer = slot({ slug: "new", boardIds: ["home", "pricing"] });
  expect(latestPublishForBoard([older, newer], "home")?.slug).toBe("new");
  expect(latestPublishForBoard([older, newer], "pricing")?.slug).toBe("new");
});

// A slot exists the moment a link is created, but a publish that never
// uploaded a version has nothing for a reviewer to look at.
test("a reserved slot with no version is not something to go and see", () => {
  const reserved = slot({ boardIds: ["home"], latestVersionId: null, lastPublishedAt: null });
  expect(latestPublishForBoard([reserved], "home")).toBe(null);
  expect(latestPublishForBoard([], "home")).toBe(null);
});

test("a board that was never in a publish offers nothing", () => {
  expect(latestPublishForBoard([slot({ boardIds: ["pricing"] })], "home")).toBe(null);
});

test("the see-all link lands on the cloud's own published-boards page", () => {
  expect(publishedBoardsUrl("http://localhost:7401")).toBe("http://localhost:7401/boards");
  expect(publishedBoardsUrl(undefined)).toBe(null);
  expect(publishedBoardsUrl("not a url")).toBe(null);
});

test("publish dates read in relative terms, and say so when there is no date", () => {
  expect(publishedWhen(new Date().toISOString())).toBe("today");
  expect(publishedWhen(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3 days ago");
  expect(publishedWhen(null)).toBe("date unknown");
  expect(publishedWhen("whenever")).toBe("date unknown");
});

// Each read is a live cloud call and the board menu asks on every open, so a
// browse through several menus has to cost one request, not one per menu.
test("destination reads are shared and reused, and forced after a publish", async () => {
  useCanvas.setState({ authStatus: signedIn, publishSlots: [] });
  server.publishSlots = [slot({ boardIds: ["home"] })];
  const reads = () => server.calls.filter((path) => path === "/api/publish/targets").length;

  const before = reads();
  await Promise.all([
    useCanvas.getState().refreshPublishSlots(),
    useCanvas.getState().refreshPublishSlots(),
  ]);
  expect(reads() - before).toBe(1);
  expect(useCanvas.getState().publishSlots).toHaveLength(1);

  await useCanvas.getState().refreshPublishSlots();
  expect(reads() - before).toBe(1);

  await useCanvas.getState().refreshPublishSlots({ force: true });
  expect(reads() - before).toBe(2);
});

test("signing out empties the destinations rather than leaving stale ones offered", async () => {
  useCanvas.setState({ authStatus: null, publishSlots: [slot({ boardIds: ["home"] })] });
  const before = server.calls.length;
  await useCanvas.getState().refreshPublishSlots();
  expect(useCanvas.getState().publishSlots).toEqual([]);
  expect(server.calls.length).toBe(before);
});

const views: Mounted[] = [];
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  server.publishedBoards = [];
  server.publishSlots = [];
  useCanvas.setState({ publishedBoardsOpen: false, authStatus: null, publishSlots: [] });
});

async function openManager() {
  useCanvas.setState({ authStatus: signedIn, publishedBoardsOpen: true });
  views.push(await mount(<PublishedBoardsDialog />));
  await settle(10);
}

domSuite("the published-boards manager", () => {
  test("lists live links with the access each one asks for", async () => {
    server.publishedBoards = [
      published(),
      published({ slug: "brand", title: "Brand", visibility: "private" }),
    ];
    await openManager();
    const rows = $$('[data-testid="published-boards-list"] li');
    expect(rows).toHaveLength(2);
    expect(text(rows[0] ?? null)).toContain("Checkout review");
    expect(text(rows[0] ?? null)).toContain("Anyone with the link");
    expect(text(rows[1] ?? null)).toContain("Your organization");
    expect($('[data-testid="published-boards-all"]')?.getAttribute("href")).toBe(
      "http://localhost:7401/boards",
    );
  });

  // Ten is what the dialog shows; the rest are the cloud page's job, and the
  // footer has to say so rather than quietly truncating.
  test("shows ten and points at the cloud for the rest", async () => {
    server.publishedBoards = Array.from({ length: 12 }, (_, i) =>
      published({ slug: `board-${i}`, title: `Board ${i}` }),
    );
    await openManager();
    expect($$('[data-testid="published-boards-list"] li')).toHaveLength(10);
    expect(text($('[data-testid="published-boards-all"]'))).toBe("See all 12 on velloo-cloud");
  });

  test("unpublishing confirms first, then drops the row", async () => {
    server.publishedBoards = [published()];
    await openManager();
    await interact(() => {
      $('[aria-label="Unpublish Checkout review"]')?.click();
    });
    // Nothing has gone yet — the confirmation is the point.
    expect(server.publishedBoards).toHaveLength(1);
    expect(text(document.body)).toContain("Unpublish “Checkout review”?");

    const confirm = [...document.querySelectorAll("button")].find(
      (button) => text(button) === "Unpublish",
    );
    await interact(() => confirm?.click());
    await settle(10);
    expect(server.publishedBoards).toHaveLength(0);
    expect($$('[data-testid="published-boards-list"] li')).toHaveLength(0);
    expect(text(document.body)).toContain("Nothing published yet");
  });

  // A teammate's link is visible so the plan's board count adds up, but it is
  // not this account's to remove — the cloud would refuse it anyway.
  test("a link this account cannot manage offers no remove", async () => {
    server.publishedBoards = [published({ canManage: false })];
    await openManager();
    const remove = $('[aria-label="Unpublish Checkout review"]') as HTMLButtonElement | null;
    expect(remove?.disabled).toBe(true);
  });
});
