/**
 * Typed answers shape the wizard produces and `init.ts` consumes. Each
 * field here corresponds to one prompt in the interactive flow and one
 * `--flag` in non-interactive mode.
 */

import type { AgentWiring } from "../connect/index.ts";
import type { ScannedRoute } from "../scan/types.ts";

export type LibraryId = "shadcn-upstream" | "none" | "mui" | "antd" | "chakra";

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

/**
 * What init scaffolds into the design folder.
 *
 * Goal modes (interactive start menu): `redesign-screen`, `component`,
 * `custom`, `sample`, `blank`.
 * `scan` remains for non-interactive `--start=scan` (legacy multi-route).
 */
export type InitialContent =
  | "sample"
  | "blank"
  | "scan"
  | "redesign-screen"
  | "component"
  | "custom";

/** Interactive start-menu goals (no full-scan). */
export type GoalMode = "redesign-screen" | "redesign-component" | "custom" | "sample" | "blank";

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
   * a scanned folder defaults to (the "existing project" flow). `mui` / `antd`
   * / `chakra` ⇒ that framework is installed; `shadcn` ⇒ a shadcn
   * `components.json` is present; undefined ⇒ none of them, so the caller
   * keeps the explicit/default library.
   */
  uiLibrary?: "shadcn" | "mui" | "antd" | "chakra";
  /**
   * A UI framework velloo doesn't adapt yet (Mantine, NextUI, …), by
   * display name. Set only when no supported framework was found. The scan
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
   * Typed screen name for `redesign-screen` when the user didn't pick a
   * scanned route (or to override the display name).
   */
  screenName?: string;
  /** Free-text target for `component` redesign. */
  componentDescription?: string;
  /** Free-text job for `custom` mode. */
  customRequest?: string;
  /** Built-in theme preset id. Undefined → the default sample theme. */
  themePreset?: string;
  /**
   * The host app's stack (see `wizard/stacks.ts`). Sets
   * `codegen.componentsAlias` in the folder config so `emit_code` mentions
   * imports under the alias the app actually uses. Undefined ⇒ codegen's
   * `@/components/ui` default.
   */
  stack?: string;
  /** Host detection result (populated for scan / redesign-screen from routes). */
  detected?: DetectedHost;
  /**
   * Routes chosen for redesign-screen or legacy scan. Interactive redesign
   * keeps at most one; non-interactive `--start=scan` may keep every route.
   */
  selectedRoutes?: ScannedRoute[];
  /**
   * Legacy scan: handoff tells the agent to choose the highest-impact
   * screen first. Unused for single-screen redesign.
   */
  agentPicksFirst?: boolean;
  /**
   * Cloud feedback opt-in, set by the interactive wizard only after the user
   * signs in. `contactOk` records consent to be contacted about the feedback.
   * Absent ⇒ feedback disabled (and always so on the non-interactive path).
   */
  feedback?: { enabled: boolean; contactOk: boolean };
  /**
   * Agent-wiring choices, asked early in the wizard (config before content)
   * but applied by init only after the scaffold is written — cancelling the
   * wizard must still mean no files were touched. Absent under --no-connect
   * and on the non-interactive path (which wires the project defaults).
   */
  agentWiring?: AgentWiring;
}
