import { isCancel, note } from "@clack/prompts";
import pc from "picocolors";
import type { LibraryId } from "./answers.ts";

export const DEFAULT_COMPONENTS_DIR = "src/components/ui";

/** What the wizard knows about the run before it asks anything. */
export interface WizardContext {
  appRoot: string;
  scanDir?: string | undefined;
  /** A valid --library flag pins the library — scan adoption won't override it. */
  pinnedLibrary?: LibraryId | undefined;
  /** Why the library is pinned, when it's worth saying (a sibling folder's choice). */
  pinnedLibraryReason?: string | undefined;
  /**
   * The sibling folder's components directory, when adding a second folder to
   * a repo that already answered that question.
   */
  inheritComponentsDir?: string | undefined;
}

/** The same, once the app root has been checked for UI code to read. */
export interface HostContext extends WizardContext {
  hasHostApp: boolean;
}

export function isAborted(value: unknown): value is symbol {
  return isCancel(value);
}

/** A `select` message with a dim second line — clack bar-prefixes it for us. */
export function subtitled(message: string, subtitle: string): string {
  return `${message}\n${pc.dim(subtitle)}`;
}

/** Same, for `text`, which doesn't bar-prefix continuation lines on its own. */
export function subtitledText(message: string, subtitle: string): string {
  return `${message}\n${pc.gray("│")}  ${pc.dim(subtitle)}`;
}

/** The last thing every path shows before init starts writing. */
export function noteSetup(appRoot: string, folder: string): void {
  note(pc.dim(`App root: ${appRoot}\nDesign:   ${folder}`), "Setup");
}
