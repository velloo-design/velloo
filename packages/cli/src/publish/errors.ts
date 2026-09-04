import type { ErrorOf } from "@velloo/protocol";
import { type CloudError, describeCloudError } from "../cloud-errors.ts";

/**
 * How `velloo publish` can fail.
 *
 * Composed rather than redeclared: the cloud half is `CloudError` verbatim,
 * plus the failures that belong to publishing itself. Two error domains meet
 * here, which is exactly the case `@velloo/result`'s `mapError` exists for —
 * a caller that only cares about the cloud half can still narrow to it.
 */
export type PublishError =
  | CloudError
  /** The cloud answered its health probe, but reported itself unwell. */
  | { kind: "CloudUnhealthy"; detail: string }
  /** The folder has nothing to publish. */
  | { kind: "NoScreens"; root: string }
  /** The chosen boards place no screens between them. */
  | { kind: "NoBoardScreens" }
  /** `--team` matched no team, or more than one. */
  | { kind: "TeamNotFound"; requested: string }
  | { kind: "TeamAmbiguous"; requested: string };

export const cloudUnhealthy = (detail: string): ErrorOf<PublishError, "CloudUnhealthy"> => ({
  kind: "CloudUnhealthy",
  detail,
});
export const noScreens = (root: string): ErrorOf<PublishError, "NoScreens"> => ({
  kind: "NoScreens",
  root,
});
export const noBoardScreens = (): ErrorOf<PublishError, "NoBoardScreens"> => ({
  kind: "NoBoardScreens",
});
export const teamNotFound = (requested: string): ErrorOf<PublishError, "TeamNotFound"> => ({
  kind: "TeamNotFound",
  requested,
});
export const teamAmbiguous = (requested: string): ErrorOf<PublishError, "TeamAmbiguous"> => ({
  kind: "TeamAmbiguous",
  requested,
});

/** Publishing's own failures; anything else is a cloud failure, rendered there. */
export function describePublishError(error: PublishError): string {
  switch (error.kind) {
    case "CloudUnhealthy":
      return error.detail;
    case "NoScreens":
      return `no screens found in ${error.root} — is this a velloo design folder?`;
    case "NoBoardScreens":
      return "the selected boards have no screens.";
    case "TeamNotFound":
      return `no team named or identified by '${error.requested}'`;
    case "TeamAmbiguous":
      return `more than one team is named '${error.requested}'; pass its UUID`;
    default:
      return describeCloudError(error);
  }
}
