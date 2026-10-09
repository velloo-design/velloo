export { detectTailwindMajor } from "./detect-tailwind.ts";
export { colorizeDiff, diffFile, type FileDiff } from "./diff.ts";
export { dynamicIconName } from "./emit-code/dynamic-icon.ts";
export { foldRepeats } from "./emit-code/fold-repeats.ts";
export {
  type EmitCodeOptions,
  type EmitCodeResult,
  type EmitSnippetOptions,
  emitCode,
  emitSnippet,
  type RepoImport,
} from "./emit-code/index.ts";
export { type CodegenTarget, frameworkTarget } from "./emit-code/target.ts";
export {
  type EmitHtmlResult,
  type EmitHtmlSnippetResult,
  emitHtml,
  emitHtmlSnippet,
} from "./emit-html/index.ts";
export { emitCssVariables } from "./emit-theme/css-variables.ts";
export {
  designMdFileName,
  type EmitDesignMdOptions,
  emitDesignMdContents,
  emitDesignMdFile,
} from "./emit-theme/design-md.ts";
export {
  DESIGN_MD_SECTIONS,
  type DesignMdSection,
  designMdSection,
  markdownSections,
} from "./emit-theme/design-md-sections.ts";
export { emitDtcgFile, emitDtcgTokens } from "./emit-theme/dtcg.ts";
export { keyframesToCss } from "./emit-theme/globals-css.ts";
export {
  type EmitThemeFile,
  type EmitThemeOptions,
  type EmitThemeResult,
  emitTheme,
} from "./emit-theme/index.ts";
export { type EmitNativeThemeOptions, emitNativeTheme } from "./emit-theme/native-theme.ts";
export type { CodegenError } from "./errors.ts";
export { type HostTailwindAdvisory, hostTailwindAdvisory } from "./host-typeset.ts";
export {
  type ParsedThemeCss,
  paletteName,
  parseThemeCss,
  resolveCssVars,
  SEMANTIC_SLOTS,
} from "./import-theme/parse-css.ts";
export {
  type ContainerConfig,
  containerClasses,
  parseTailwindContainer,
  parseThemeExtend,
  type ThemeExtend,
} from "./import-theme/parse-tailwind-config.ts";
export { classNamesInJsx, type V3ClassIssue, v3ClassIssues } from "./tailwind-compat.ts";
export { isKnownLucideIcon, REMOVED_BRAND_ICONS } from "./velloo-primitives.ts";
