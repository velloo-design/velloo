import { join } from "node:path";
import { ok, type Result } from "@velloo/result";
import type { DesignFolder } from "../design-folder.ts";
import { writeText } from "../fs.ts";
import type { ThemeError } from "./errors.ts";

export interface CustomCssResult {
  /** Current contents of theme/custom.css. */
  css: string;
  bytes: number;
}

/**
 * Read or replace the folder's escape-hatch stylesheet. Keyframes,
 * grain textures, clip-paths, selection colors — anything Tailwind
 * utilities can't express. Injected into every rendered document after
 * the theme variables, and appended to emitted globals.css.
 */
export async function setCustomCss(
  folder: DesignFolder,
  css: string,
): Promise<Result<CustomCssResult, ThemeError>> {
  await writeText(join(folder.root, "theme", "custom.css"), css);
  folder.customCss = css;
  return ok({ css, bytes: Buffer.byteLength(css, "utf8") });
}
