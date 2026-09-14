import type { PublishTargets } from "../../api.ts";

type Slot = PublishTargets["slots"][number];

interface PublishSource {
  boardIds: string[];
  teamId: string | null;
  repo: string | null;
  branch: string | null;
}

/**
 * Why an existing share link isn't this publish's link — empty when it is.
 * Updating a link replaces what its reviewers see, so a destination is only
 * offered when the team, the board selection and the source repo all agree.
 */
export function canvasSlotMismatches(slot: Slot, current: PublishSource): string[] {
  const mismatches: string[] = [];
  if (!slot.context.contextKnown) mismatches.push("board context is unknown");
  if (slot.teamId !== current.teamId) mismatches.push("team differs");
  const sorted = (ids: string[]) => [...new Set(ids)].sort();
  if (JSON.stringify(sorted(slot.context.boardIds)) !== JSON.stringify(sorted(current.boardIds))) {
    mismatches.push("board selection differs");
  }
  if (slot.context.repo !== current.repo) {
    mismatches.push("repository differs");
  } else if (current.repo !== null) {
    if (!slot.context.branch || !current.branch) mismatches.push("branch is unavailable");
    else if (slot.context.branch !== current.branch) mismatches.push("branch differs");
  }
  return mismatches;
}

export function canvasMatchingSlots(slots: Slot[], current: PublishSource): Slot[] {
  return slots.filter((slot) => canvasSlotMismatches(slot, current).length === 0);
}

/** The most recently published matching link, or null when none matches. */
export function canvasLatestMatchingSlot(slots: Slot[], current: PublishSource): Slot | null {
  return (
    canvasMatchingSlots(slots, current).sort(
      (left, right) => publishedAt(right.lastPublishedAt) - publishedAt(left.lastPublishedAt),
    )[0] ?? null
  );
}

const publishedAt = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};
