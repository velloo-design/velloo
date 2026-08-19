import type { Theme } from "@velloo/schema";
import { postTheme } from "./http.ts";

export const theme = {
  setToken(path: string, value: string | number) {
    return postTheme<{ theme: Theme }>("set_token", { path, value });
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
