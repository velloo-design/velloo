import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { diffFile } from "../diff.ts";
import { jsLiteral } from "../emit-code/js-literal.ts";
import type { EmitThemeResult } from "./index.ts";

export interface EmitMuiThemeOptions {
  /** Directory to write into (or diff against). e.g. ../my-app/src */
  outputDir: string;
  /** Where the theme module lands, relative to `outputDir`. Default `theme.ts`. */
  themePath?: string;
  /**
   * The dark projection of the theme (`themeToNative(theme, true)`). When set,
   * a second `darkTheme` is emitted alongside `theme` so the app can pair them
   * with a mode toggle — otherwise dark mode would flip `palette.mode` over the
   * light color values.
   */
  darkThemeOptions?: unknown;
  /** Whether to actually write the file. Default false → returns the diff only. */
  apply?: boolean;
}

/**
 * Emit a MUI `createTheme(...)` module from the framework adapter's native
 * theme options (provider-mui's `muiThemeOptions`, the single source of the
 * velloo→MUI mapping — so the emitted theme matches the canvas render). The
 * caller passes the already-projected `ThemeOptions` POJO; codegen just
 * serializes it to an idiomatic TS module. This is the MUI counterpart to
 * `emitTheme`'s Tailwind globals.css.
 */
export async function emitMuiTheme(
  themeOptions: unknown,
  options: EmitMuiThemeOptions,
): Promise<EmitThemeResult> {
  const themePath = join(options.outputDir, options.themePath ?? "theme.ts");
  const darkBlock =
    options.darkThemeOptions !== undefined
      ? `\nexport const darkTheme = createTheme(${jsLiteral(options.darkThemeOptions)});\n`
      : "";
  const contents = `import { createTheme } from "@mui/material/styles";

export const theme = createTheme(${jsLiteral(themeOptions)});
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
