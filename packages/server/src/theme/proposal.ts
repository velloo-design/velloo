import type { ContrastPair, ThemeError } from "@velloo/protocol";
import { err, type Result } from "@velloo/result";
import type { SketchbookProposal, Theme } from "@velloo/schema";
import { scoreThemeContrastBoth } from "./contrast.ts";
import { applyFonts } from "./set-fonts.ts";
import { applyTokens } from "./set-token.ts";

/**
 * A sketchbook direction's proposed tokens, applied to a theme the way
 * `set_theme` applies `tokens` then `fonts` — in memory, written nowhere. The
 * write that records a proposal, the specimen that previews it and the Look
 * made from it all go through here, so a proposal that validated is one that
 * lands.
 */
export function applyProposal(
  base: Theme,
  proposal: SketchbookProposal,
): Result<Theme, ThemeError> {
  const tokens = applyTokens(
    base,
    Object.entries(proposal.tokens).map(([path, value]) => ({ path, value })),
  );
  if (!tokens.ok) return tokens;
  return applyFonts(tokens.value.theme, proposal.fonts);
}

/** A proposal's failure in one line, for the agent and the canvas. */
export function describeProposalError(error: ThemeError): string {
  switch (error.kind) {
    case "BulkTokensInvalid":
      return error.failed.map((f) => `${f.path}: ${f.reason}`).join("; ");
    case "InvalidThemePath":
    case "InvalidColor":
      return error.reason;
    case "BadRequest":
      return error.message;
    case "UnknownPreset":
      return `unknown preset "${error.presetName}"`;
  }
}

/** The proposal applied and scored as `score_theme_contrast` scores a theme. */
export function proposalContrast(
  base: Theme,
  proposal: SketchbookProposal,
): Result<ContrastPair[], ThemeError> {
  const applied = applyProposal(base, proposal);
  if (!applied.ok) return err(applied.error);
  return { ok: true, value: scoreThemeContrastBoth(applied.value) };
}

/** The pairs under AA: what the agent is asked to fix and the canvas flags. */
export const failingPairs = (pairs: ContrastPair[]): ContrastPair[] =>
  pairs.filter((p) => p.tier === "Fail" || p.tier === "AAlarge");
