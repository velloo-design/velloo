/**
 * Typed answers shape the wizard produces and `init.ts` consumes. Each
 * field here corresponds to one prompt in the interactive flow and one
 * `--flag` in non-interactive mode.
 */

import type { ProductSurface } from "../scaffold/sample-page.ts";
import type { ScannedRoute } from "../scan/types.ts";

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
  /**
   * The host's UI framework, inferred from dependencies — drives which adapter
   * a scanned folder defaults to (the "existing project" flow). `mui` ⇒ MUI is
   * installed; `shadcn` ⇒ a shadcn `components.json` is present; undefined ⇒
   * neither, so the caller keeps the explicit/default library.
   */
  uiLibrary?: "shadcn" | "mui";
  /**
   * A UI framework velloo doesn't adapt yet (Chakra, Mantine, Ant Design, …),
   * by display name. Set only when no supported framework was found. The scan
   * flow falls back to the no-framework adapter (div-backed primitives) — the
   * agent approximates the app's components and preserves their real imports
   * via `$emitAs`. Undefined ⇒ no unsupported framework detected.
   */
  unsupportedUi?: string;
}

export interface WizardAnswers {
  /**
   * Absolute path to the user's app root — where Velloo is being installed.
   * The init positional arg, or the current directory when omitted.
   */
  appRoot: string;
  /**
   * Absolute path the scan reads from — `appRoot` for most apps, but a nested
   * UI folder (e.g. `web/frontend`) when the app lives in a subfolder, picked
   * by `--scan-dir` or auto-discovery. Velloo still installs at `appRoot`;
   * only route detection + theme import use this. Equals `appRoot` off the
   * scan flow.
   */
  scanRoot: string;
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
  /**
   * What the user is designing — tailors which slice of the Pulse sample
   * ships (see `ProductSurface`). Only meaningful for a shadcn `sample`
   * scaffold; undefined ⇒ the full sample (the historical default).
   */
  productSurface?: ProductSurface;
  /** Built-in theme preset id. Undefined → the default Pulse theme. */
  themePreset?: string;
  /**
   * Vibe id (see `scaffold/vibes.ts`) — the "pick by feel" alternative to a
   * preset. Mutually exclusive with `themePreset`; wins when set.
   */
  themeVibe?: string;
  /**
   * The host app's stack (see `wizard/stacks.ts`). Sets
   * `codegen.componentsAlias` in the folder config so `emit_code` mentions
   * imports under the alias the app actually uses. Undefined ⇒ codegen's
   * `@/components/ui` default.
   */
  stack?: string;
  /** Host detection result (populated when `initialContent === "scan"`). */
  detected?: DetectedHost;
  /**
   * Scanned routes the user chose to scaffold into screens + board frames
   * (scan flow). The interactive wizard populates this from the screen
   * picker. When undefined (non-interactive scan), `buildScaffold` scans
   * and uses every detected route.
   */
  selectedRoutes?: ScannedRoute[];
  /**
   * Scan flow: the handoff prompt tells the agent to choose the
   * highest-impact screen itself and design it first. True on the wizard's
   * default "all screens" path and on non-interactive scans; false when the
   * user hand-picked screens.
   */
  agentPicksFirst?: boolean;
  /**
   * Cloud feedback opt-in, set by the interactive wizard only after the user
   * signs in. `contactOk` records consent to be contacted about the feedback.
   * Absent ⇒ feedback disabled (and always so on the non-interactive path).
   */
  feedback?: { enabled: boolean; contactOk: boolean };
}
