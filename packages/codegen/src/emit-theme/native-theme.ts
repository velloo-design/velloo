import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThemeModuleSpec } from "@velloo/provider";
import { diffFile } from "../diff.ts";
import { jsLiteral } from "../emit-code/js-literal.ts";
import type { EmitThemeResult } from "./index.ts";

export interface EmitNativeThemeOptions {
  /** The adapter's module shape (imports, factory, default path). */
  spec: ThemeModuleSpec;
  /** Directory to write into (or diff against). e.g. ../my-app/src */
  outputDir: string;
  /** Where the theme module lands, relative to `outputDir`. Default `spec.defaultPath`. */
  themePath?: string;
  /**
   * The dark projection of the theme (`themeToNative(theme, true)`). When set,
   * a second `darkTheme` is emitted alongside `theme` so the app can pair them
   * with a mode toggle — otherwise dark mode would flip the framework's mode
   * flag over the light color values.
   */
  darkThemeOptions?: unknown;
  /** Whether to actually write the file. Default false → returns the diff only. */
  apply?: boolean;
}

/**
 * Emit a framework-native theme module from the adapter's projected options
 * (`themeToNative`, the single source of the velloo→framework mapping — so the
 * emitted theme matches the canvas render). The adapter's `ThemeModuleSpec`
 * shapes the module (imports + factory); codegen just serializes. This is the
 * native counterpart to `emitTheme`'s Tailwind globals.css — MUI emits
 * `createTheme({...})`, other frameworks declare their own spec, and no
 * framework import appears outside its provider package.
 */
export async function emitNativeTheme(
  themeOptions: unknown,
  options: EmitNativeThemeOptions,
): Promise<EmitThemeResult> {
  const { spec } = options;
  const themePath = join(options.outputDir, options.themePath ?? spec.defaultPath);
  const wrap = (value: unknown): string =>
    spec.factory ? `${spec.factory}(${jsLiteral(value)})` : jsLiteral(value);
  const darkBlock =
    options.darkThemeOptions !== undefined
      ? `\nexport const darkTheme = ${wrap(options.darkThemeOptions)};\n`
      : "";
  const contents = `${spec.importLines.join("\n")}

export const theme = ${wrap(themeOptions)};
${darkBlock}`;
  const diff = await diffFile(themePath, contents);
  let applied = false;
  if (options.apply && !diff.identical) {
    await mkdir(dirname(themePath), { recursive: true });
    await writeFile(themePath, contents, "utf8");
    applied = true;
  }
  return { files: [{ path: themePath, contents, diff, applied, errors: [] }], warnings: [] };
}
