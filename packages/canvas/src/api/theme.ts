import type { Theme } from "@velloo/schema";
import { postTheme } from "./http.ts";

/**
 * One typeset edit. Mirrors the server's `TypesetSpec`: absent leaves a control
 * alone, `null` clears it back to inherited.
 */
export interface TypesetSpec {
  name?: string;
  renameTo?: string;
  remove?: boolean;
  size?: string | number | null;
  leading?: number | null;
  flow?: string | number | null;
  fontBody?: string | null;
  fontHeading?: string | null;
  fontMono?: string | null;
}

export const theme = {
  setToken(path: string, value: string | number) {
    return postTheme<{ theme: Theme }>("set_token", { path, value });
  },
  setTypeset(typesets: TypesetSpec[]) {
    return postTheme<{ theme: Theme }>("set_typeset", { typesets });
  },
  applyPreset(presetName: string) {
    return postTheme<{ theme: Theme }>("apply_preset", { presetName });
  },
  deriveFromColor(seedColor: string, name?: string) {
    return postTheme<{ theme: Theme; adjustments: unknown[] }>("derive_palette_from_color", {
      seedColor,
      name,
    });
  },
};
