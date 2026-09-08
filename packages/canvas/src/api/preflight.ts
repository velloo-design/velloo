import { getJson } from "./discovery.ts";

/**
 * Client side of /api/preflight: which components would fail to render in the
 * screens an export or publish is about to cover. The canvas cannot render, so
 * it asks the daemon before starting work whose output leaves the machine.
 */
export interface ScreenRenderFailure {
  screenId: string;
  screenName: string;
  /** The component that threw, or null when the whole screen render failed. */
  componentId: string | null;
  reason: string;
}

export function preflightExportTarget(
  kind: "frame" | "board" | "screen",
  id: string,
): Promise<ScreenRenderFailure[]> {
  const params = new URLSearchParams({ kind, id });
  return getJson<{ failures: ScreenRenderFailure[] }>(
    `/api/preflight?${params}`,
    "preflightExportTarget",
  ).then((body) => body.failures);
}

export function preflightBoards(boardIds: string[]): Promise<ScreenRenderFailure[]> {
  const params = new URLSearchParams(boardIds.length > 0 ? { boards: boardIds.join(",") } : {});
  return getJson<{ failures: ScreenRenderFailure[] }>(
    `/api/preflight?${params}`,
    "preflightBoards",
  ).then((body) => body.failures);
}

/** One line per failure, matching what the CLI prints. */
export function failureLine(failure: ScreenRenderFailure): string {
  return failure.componentId === null
    ? `${failure.screenName}: ${failure.reason}`
    : `${failure.screenName} — ${failure.componentId}: ${failure.reason}`;
}
