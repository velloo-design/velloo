import { describe, expect, test } from "bun:test";
import type { CloudPublishSlot } from "../cloud-upload.ts";
import { choosePublishDestination, resolvePublishDestinationChoice } from "../commands/publish.ts";
import {
  exactPublishSlots,
  type PublishSourceContext,
  publishSlotMismatches,
  recommendedPublishSlot,
} from "../publish/core.ts";

const slot = (overrides: Partial<CloudPublishSlot> = {}): CloudPublishSlot => ({
  slug: "main-review",
  url: "/s/main-review/",
  title: "Main review",
  teamId: null,
  visibility: "public",
  passwordProtected: false,
  latestVersionId: "11111111-1111-4111-8111-111111111111",
  lastPublishedAt: "2030-01-01T00:00:00.000Z",
  context: {
    boardIds: ["checkout", "home"],
    selectionFingerprint: "fingerprint",
    contextKnown: true,
    repo: "github.com/velloo/app",
    branch: "main",
  },
  ...overrides,
});

const source = (overrides: Partial<PublishSourceContext> = {}): PublishSourceContext => ({
  boardIds: ["home", "checkout"],
  teamId: null,
  repo: "github.com/velloo/app",
  branch: "main",
  ...overrides,
});

describe("publish destination recommendations", () => {
  test("an exact team, board, repository, and branch match recommends an update", () => {
    const existing = slot();
    expect(publishSlotMismatches(existing, source())).toEqual([]);
    expect(recommendedPublishSlot([existing], source())?.slug).toBe(existing.slug);
  });

  test("branch and board-selection differences recommend a new link", () => {
    expect(publishSlotMismatches(slot(), source({ branch: "feature/cart" }))).toContain(
      "branch differs",
    );
    expect(publishSlotMismatches(slot(), source({ boardIds: ["home"] }))).toContain(
      "board selection differs",
    );
    expect(recommendedPublishSlot([slot()], source({ branch: "feature/cart" }))).toBeNull();
    expect(exactPublishSlots([slot()], source({ branch: "feature/cart" }))).toEqual([]);
  });

  test("folders outside Git match normally without a repository or branch", () => {
    const local = slot({
      context: {
        ...slot().context,
        repo: null,
        branch: null,
      },
    });
    const localSource = source({ repo: null, branch: null });
    expect(publishSlotMismatches(local, localSource)).toEqual([]);
    expect(recommendedPublishSlot([local], localSource)?.slug).toBe(local.slug);
  });

  test("a Git repository with unavailable branch context is not auto-matched", () => {
    expect(publishSlotMismatches(slot(), source({ branch: null }))).toContain(
      "branch is unavailable",
    );
  });

  test("cancelling the destination prompt produces no publish choice", () => {
    expect(resolvePublishDestinationChoice(null, [slot()])).toBeNull();
    expect(resolvePublishDestinationChoice("new", [slot()])).toEqual({ mode: "new" });
    expect(resolvePublishDestinationChoice("update:main-review", [slot()])).toEqual({
      mode: "update",
      slug: "main-review",
      expectedVersionId: "11111111-1111-4111-8111-111111111111",
    });
  });

  test("only exact matches are eligible update choices", () => {
    const matching = slot({ title: "Matching design" });
    const mismatched = slot({
      slug: "old-branch",
      title: "Old branch",
      context: { ...slot().context, branch: "feature/old" },
    });
    expect(exactPublishSlots([mismatched, matching], source())).toEqual([matching]);
  });

  test("exact matches are ordered newest first", () => {
    const older = slot({ slug: "older", lastPublishedAt: "2030-01-01T00:00:00.000Z" });
    const newest = slot({ slug: "newest", lastPublishedAt: "2030-02-01T00:00:00.000Z" });
    expect(exactPublishSlots([older, newest], source())).toEqual([newest, older]);
    expect(recommendedPublishSlot([older, newest], source())).toEqual(newest);
  });

  test("a missing exact match automatically creates a new link and announces it", async () => {
    const messages: string[] = [];
    const destination = await choosePublishDestination({
      slots: [slot()],
      source: source({ branch: "feature/cart" }),
      interactive: true,
      createNew: false,
      updateExisting: false,
      manageUrl: "https://cloud.velloo.dev/boards",
      log: (message) => messages.push(message),
    });

    expect(destination).toEqual({ mode: "new" });
    expect(messages).toEqual([
      "velloo publish: no matching published design — a new link will be created.",
    ]);
  });
});
