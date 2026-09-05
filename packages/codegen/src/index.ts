export { isKnownLucideIcon, REMOVED_BRAND_ICONS } from "./component-registry.ts";
export { detectTailwindMajor } from "./detect-tailwind.ts";
export { colorizeDiff, diffFile, type FileDiff } from "./diff.ts";
export { dynamicIconName } from "./emit-code/dynamic-icon.ts";
export {
  type EmitCodeOptions,
  type EmitCodeResult,
  type EmitSnippetOptions,
  emitCode,
  emitSnippet,
} from "./emit-code/index.ts";
export { type CodegenTarget, moduleTarget } from "./emit-code/target.ts";
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
