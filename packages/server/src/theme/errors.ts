import type { ThemeError } from "@velloo/protocol";

/**
 * Theme failure modes. Same split as `mutations/errors.ts`: the union is a
 * wire type and lives in `@velloo/protocol`, the constructors live here.
 */
export type { ThemeError } from "@velloo/protocol";

// Constructor helpers.
export const invalidColor = (reason: string, hint?: string): ThemeError => ({
  kind: "InvalidColor",
  reason,
  ...(hint !== undefined ? { hint } : {}),
});
export const invalidThemePath = (reason: string, hint?: string): ThemeError => ({
  kind: "InvalidThemePath",
  reason,
  ...(hint !== undefined ? { hint } : {}),
});
export const unknownPreset = (presetName: string, hint?: string): ThemeError => ({
  kind: "UnknownPreset",
  presetName,
  ...(hint !== undefined ? { hint } : {}),
});
export const themeBadRequest = (message: string, issues?: unknown): ThemeError => ({
  kind: "BadRequest",
  message,
  ...(issues !== undefined ? { issues } : {}),
});
