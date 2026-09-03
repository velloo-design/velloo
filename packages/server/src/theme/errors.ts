import type { ErrorOf, ThemeError } from "@velloo/protocol";

/**
 * Theme failure modes. Same split as `mutations/errors.ts`: the union is a
 * wire type and lives in `@velloo/protocol`, the constructors live here and
 * each returns its own variant rather than the whole union.
 */
export type { ThemeError } from "@velloo/protocol";

// Constructor helpers.
export const invalidColor = (
  reason: string,
  hint?: string,
): ErrorOf<ThemeError, "InvalidColor"> => ({
  kind: "InvalidColor",
  reason,
  ...(hint !== undefined ? { hint } : {}),
});
export const invalidThemePath = (
  reason: string,
  hint?: string,
): ErrorOf<ThemeError, "InvalidThemePath"> => ({
  kind: "InvalidThemePath",
  reason,
  ...(hint !== undefined ? { hint } : {}),
});
export const unknownPreset = (
  presetName: string,
  hint?: string,
): ErrorOf<ThemeError, "UnknownPreset"> => ({
  kind: "UnknownPreset",
  presetName,
  ...(hint !== undefined ? { hint } : {}),
});
export const themeBadRequest = (
  message: string,
  issues?: unknown,
): ErrorOf<ThemeError, "BadRequest"> => ({
  kind: "BadRequest",
  message,
  ...(issues !== undefined ? { issues } : {}),
});
