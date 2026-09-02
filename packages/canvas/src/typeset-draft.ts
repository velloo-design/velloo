import {
  DEFAULT_TYPESET_NAME,
  isTypesetName,
  type Typeset,
  typesetBaseVars,
} from "@velloo/schema/typeset";

export interface TypesetDraft {
  name: string;
  typeset: Typeset;
}

/**
 * The stylesheet that previews an uncommitted typeset inside a frame.
 *
 * It re-declares only the three authored controls (plus font roles), exactly
 * as `typesetCss` does — the derived `--text-*` / `--leading-*` ladder lives in
 * the same rule as those controls, so re-declaring them in a later rule
 * re-substitutes the whole scale with no reload. A preset emits only what it
 * authored, or restating an unauthored control would silently sever its
 * inheritance from the baseline for as long as the drag lasts.
 */
export function typesetDraftCss(draft: TypesetDraft): string {
  const isDefault = draft.name === DEFAULT_TYPESET_NAME;
  if (!isDefault && !isTypesetName(draft.name)) return "";
  const declarations = typesetBaseVars(draft.typeset, "  ", !isDefault);
  if (declarations.length === 0) return "";
  const selector = isDefault ? ":root, .typeset" : `.typeset-${draft.name}`;
  return `${selector} {\n${declarations.join("\n")}\n}`;
}
