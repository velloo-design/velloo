import type { Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { persistTheme } from "../mutations/persist.ts";
import { ThemeError } from "./errors.ts";

/**
 * Apply a single token at a dot-path. Creates intermediate objects as needed.
 * The full theme is schema-validated by `persistTheme` so invalid paths or
 * value types are caught at persistence time.
 */
export async function setToken(
  folder: DesignFolder,
  path: string,
  value: string | number,
): Promise<Theme> {
  if (!path) {
    throw new ThemeError({ code: "INVALID_PATH", message: "path is required" });
  }
  const segments = path.split(".");
  if (segments.some((s) => s === "")) {
    throw new ThemeError({ code: "INVALID_PATH", message: `bad path: ${JSON.stringify(path)}` });
  }

  // Deep-clone the current theme so we don't mutate the cached object.
  const next = JSON.parse(JSON.stringify(folder.theme)) as Record<string, unknown>;
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i] as string;
    const existing = cursor[k];
    if (existing === undefined || typeof existing !== "object" || existing === null) {
      cursor[k] = {};
    }
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;

  try {
    return await persistTheme(folder, next as unknown as Theme);
  } catch (err) {
    throw new ThemeError({
      code: "INVALID_PATH",
      message: `Setting ${path} to ${JSON.stringify(value)} produced an invalid theme: ${
        (err as Error).message
      }`,
    });
  }
}
