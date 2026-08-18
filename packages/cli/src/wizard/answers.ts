/**
 * Typed answers shape the wizard produces and `init.ts` consumes. Each
 * field here corresponds to one prompt in the interactive flow and one
 * `--flag` in non-interactive mode.
 */

export type LibraryId = "shadcn-react" | "shadcn-upstream" | "none" | "mui";

/**
 * Where the library's component sources live.
 *
 *   "binary"  — bundled with the velloo binary (no install). Init never
 *               writes components to disk, so every fresh folder records
 *               `binary`; the real upstream install is deferred to the
 *               post-init agent step (see `WizardAnswers.componentsRelative`).
 *   "in-repo" — components live in the user's app (written later, by the agent).
 *   "cache"   — copied to `~/.velloo/<projectId>/components/` (legacy).
 */
export type LibrarySource = "binary" | "in-repo" | "cache";

export type InitialContent = "sample" | "blank" | "scan";

/** What `scan` detected about the host app — surfaced to the user and the agent handoff. */
export interface DetectedHost {
  /** A shadcn `components.json` was found. */
  shadcn: boolean;
  /** shadcn style (`new-york` / `default`) from components.json, if present. */
  shadcnStyle?: string;
  /** Host Tailwind major version, or null if undetectable. */
  tailwindMajor: 3 | 4 | null;
  /** Resolved path to the host's global stylesheet, if found. */
  globalsCssPath?: string;
}

export interface WizardAnswers {
  /**
   * Absolute path to the user's app root — where Velloo is being installed.
   * The init positional arg, or the current directory when omitted.
   */
  appRoot: string;
  /** Absolute path to the design folder being created (under `appRoot`). */
  folder: string;
  library: LibraryId;
  source: LibrarySource;
  /**
   * Subfolder inside the app where upstream components will live, relative
   * to `appRoot` (e.g. `src/components/ui`). Only meaningful for upstream;
   * the actual write happens post-init so init never touches the app.
   */
  componentsRelative: string;
  initialContent: InitialContent;
  /** Built-in theme preset id. Undefined → the default Pulse theme. */
  themePreset?: string;
  /** Host detection result (populated when `initialContent === "scan"`). */
  detected?: DetectedHost;
}
