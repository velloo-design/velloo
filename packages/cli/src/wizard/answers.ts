/**
 * Typed answers shape the wizard produces and `init.ts` consumes. Each
 * field here corresponds to one prompt in the interactive flow and one
 * `--flag` in non-interactive mode.
 */

export type LibraryId = "shadcn-react" | "none" | "mui";

/**
 * Where the library's component sources live.
 *
 *   "binary"  — bundled with the velloo binary (no install).
 *   "in-repo" — copied into the user's app at `appPath/componentsDir`.
 *   "cache"   — copied to `~/.velloo/<projectId>/components/`.
 */
export type LibrarySource = "binary" | "in-repo" | "cache";

export type InitialContent = "sample" | "blank" | "scan";

export interface WizardAnswers {
  /** Absolute path to the design folder being created. */
  folder: string;
  library: LibraryId;
  source: LibrarySource;
  /**
   * Absolute path to the user's app root (the directory containing
   * `package.json`). Only meaningful for `source === "in-repo"`.
   */
  appPath?: string;
  /**
   * Path inside the app where component sources land, relative to
   * `appPath`. Defaults to `src/components/ui`.
   */
  componentsRelative: string;
  initialContent: InitialContent;
  /** Hex color for the theme primary. Empty string means "don't set". */
  themeColor?: string;
  /** Vibe keyword passed to match_vibe (calm / playful / professional / energetic). */
  themeVibe?: string;
}
