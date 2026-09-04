import type { Theme } from "@velloo/schema";
import { postTheme } from "./http.ts";

/**
 * One typeset edit. Mirrors the server's `TypesetSpec`: absent leaves a control
 * alone, `null` clears it back to inherited.
 */
export interface TypesetSpec {
  name?: string | undefined;
  renameTo?: string | undefined;
  remove?: boolean | undefined;
  size?: string | number | null | undefined;
  leading?: number | null | undefined;
  flow?: string | number | null | undefined;
  fontBody?: string | null | undefined;
  fontHeading?: string | null | undefined;
  fontMono?: string | null | undefined;
}

/**
 * One font-role edit. Mirrors the server's `FontSpec`: `family` is required
 * except when removing the role.
 */
export interface FontSpec {
  role: string;
  family?: string | undefined;
  fallback?: string | undefined;
  google?: string | true | undefined;
  remove?: boolean | undefined;
}

/**
 * Theme writes, each scoped to the theme it targets.
 *
 * `themeName` is required rather than defaulted: a board can pin its own theme
 * (`Board.theme`), and a call that quietly fell back to `default` would write a
 * file nothing on screen renders with — an edit that looks like it did nothing.
 * Pass `theme.name` from the loaded theme, which is the one the frames use.
 */
export const theme = {
  setToken(themeName: string, path: string, value: string | number) {
    return postTheme<{ theme: Theme }>("set_token", { path, value, theme: themeName });
  },
  setTypeset(themeName: string, typesets: TypesetSpec[]) {
    return postTheme<{ theme: Theme }>("set_typeset", { typesets, theme: themeName });
  },
  setFonts(themeName: string, fonts: FontSpec[]) {
    return postTheme<{ theme: Theme }>("set_fonts", { fonts, theme: themeName });
  },
  applyPreset(themeName: string, presetName: string) {
    return postTheme<{ theme: Theme }>("apply_preset", { presetName, theme: themeName });
  },
  /** Clone a theme under a new name. `from` defaults to the folder default. */
  addTheme(name: string, from?: string) {
    return postTheme<{ name: string; theme: Theme }>("add_theme", { name, from });
  },
  // `name` here is a *new* theme to write the derived palette into, so it wins
  // over the theme being viewed when present.
  deriveFromColor(themeName: string, seedColor: string, name?: string) {
    return postTheme<{ theme: Theme; adjustments: unknown[] }>("derive_palette_from_color", {
      seedColor,
      name: name ?? (themeName === "default" ? undefined : themeName),
    });
  },
};
