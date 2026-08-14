import { err, ok, type Result } from "@velloo/result";
import { findDuplicateIds, type Screen } from "@velloo/schema";
import { idConflict, type MutationError } from "./errors.ts";

/**
 * `$id` uniqueness check on a screen. Wraps the schema-level walker with
 * the server's `MutationError` variant so persist.ts can short-circuit
 * with a typed error.
 */
export function validateScreenIds(screenId: string, screen: Screen): Result<void, MutationError> {
  const dupes = findDuplicateIds(screen.tree);
  const first = dupes[0];
  if (first) return err(idConflict(screenId, first.id, first.paths));
  return ok(undefined);
}
