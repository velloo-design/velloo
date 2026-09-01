import type { ViewportPreset } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postMutate } from "./http.ts";

/**
 * The folder's settings — the editable half of `config.json` plus the
 * read-only facts `init` decided. Served whole by `/api/config` rather than
 * folded into the design summary: only the settings dialog reads it, and it
 * would otherwise ride along on every canvas boot.
 */
export interface FolderConfig {
  /** Absolute path to the design folder, shown so the dialog names what it edits. */
  root: string;
  folderName: string;
  schemaVersion: number;
  toolVersion: string;
  folderId: string | null;
  defaultLibrary: string;
  libraries: { id: string; providerId: string; version: string; source: string }[];
  /** CSS framework, or null when the folder predates the styling axis. */
  styling: "tailwind" | "none" | null;
  viewportPresets: ViewportPreset[];
  defaultBoard: string | null;
  defaultScreen: string | null;
  componentsAlias: string | null;
  feedback: { enabled: boolean; contactOk: boolean };
  /** Named themes a board can pin, "default" first. */
  themes: string[];
  extensionsCount: number;
}

export function fetchConfig(): Promise<FolderConfig> {
  return getJson("/api/config", "fetchConfig");
}

export const config = {
  viewportPresets(presets: ViewportPreset[]) {
    return postMutate<{ presets: ViewportPreset[] }>("update_viewport_presets", { presets });
  },
  /** Omit a key to leave it alone; pass null to clear it. */
  defaults(args: { defaultBoard?: string | null; defaultScreen?: string | null }) {
    return postMutate<{ defaultBoard: string | null; defaultScreen: string | null }>(
      "update_defaults",
      args,
    );
  },
  codegen(args: { componentsAlias: string | null }) {
    return postMutate<{ componentsAlias: string | null }>("update_codegen", args);
  },
  feedback(args: { enabled?: boolean; contactOk?: boolean }) {
    return postMutate<{ enabled: boolean; contactOk: boolean }>("update_feedback", args);
  },
};
