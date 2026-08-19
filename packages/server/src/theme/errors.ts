/**
 * Theme failure modes. Same pattern as MutationError — `kind`-keyed
 * discriminated union, paired with Result. Routes/MCP tools `switch
 * (error.kind)` and the `never` exhaustiveness guard breaks the build on
 * a missing case.
 */
export type ThemeError =
  | { kind: "InvalidColor"; reason: string; hint?: string }
  | { kind: "InvalidThemePath"; reason: string; hint?: string }
  | { kind: "UnknownPreset"; presetName: string; hint?: string }
  | { kind: "BadRequest"; message: string; issues?: unknown };

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
