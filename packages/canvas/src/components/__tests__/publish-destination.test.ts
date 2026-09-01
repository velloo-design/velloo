import { expect, test } from "bun:test";
import type { PublishTargets } from "../../api/publish.ts";
import {
  canvasLatestMatchingSlot,
  canvasMatchingSlots,
  canvasSlotMismatches,
} from "../PublishDialog.tsx";

const localSlot: PublishTargets["slots"][number] = {
  slug: "local-review",
  url: "/s/local-review/",
  title: "Local review",
  teamId: null,
  latestVersionId: "11111111-1111-4111-8111-111111111111",
  lastPublishedAt: "2030-01-01T00:00:00.000Z",
  context: {
    boardIds: ["home"],
    contextKnown: true,
    repo: null,
    branch: null,
  },
};

test("Canvas treats a non-Git folder as a normal matching publish source", () => {
  expect(
    canvasSlotMismatches(localSlot, {
      boardIds: ["home"],
      teamId: null,
      repo: null,
      branch: null,
    }),
  ).toEqual([]);
});

test("Canvas detects a slot with a different board selection", () => {
  expect(
    canvasSlotMismatches(localSlot, {
      boardIds: ["checkout"],
      teamId: null,
      repo: null,
      branch: null,
    }),
  ).toContain("board selection differs");
});

test("Canvas exposes only exact matches as update destinations", () => {
  const mismatch: PublishTargets["slots"][number] = {
    ...localSlot,
    slug: "other-boards",
    context: { ...localSlot.context, boardIds: ["pricing"] },
  };
  expect(
    canvasMatchingSlots([mismatch, localSlot], {
      boardIds: ["home"],
      teamId: null,
      repo: null,
      branch: null,
    }),
  ).toEqual([localSlot]);
});

test("Canvas selects only the newest exact match", () => {
  const older: PublishTargets["slots"][number] = {
    ...localSlot,
    slug: "older-review",
    title: "Older review",
    lastPublishedAt: "2029-01-01T00:00:00.000Z",
  };
  expect(
    canvasLatestMatchingSlot([older, localSlot], {
      boardIds: ["home"],
      teamId: null,
      repo: null,
      branch: null,
    }),
  ).toEqual(localSlot);
});
