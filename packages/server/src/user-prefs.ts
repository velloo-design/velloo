import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Preferences that belong to the *person*, not to a repo or a design folder —
 * `~/.velloo/prefs.json`, alongside the saved cloud credentials.
 *
 * Feedback consent splits across both levels on purpose. Whether the
 * `send_feedback` tool exists at all is a repo decision, committed in
 * `velloo.json` so a clone inherits it. Whether *you* are happy to be
 * contacted about what you send is personal: it is never committed, so
 * cloning a repo can't opt a different person into being emailed.
 *
 * The canvas's own cross-run memory lives here too. Each daemon serves the
 * canvas from its own port, and a browser keeps storage per origin, so
 * anything the canvas kept only in localStorage would be forgotten by the
 * next design or the next run.
 */
interface UserPrefsFile {
  version: 1;
  /** Consent to be contacted about feedback sent from this machine. */
  feedbackContactOk?: boolean;
  /** The canvas hints this person has dismissed, by id. */
  canvasHintsSeen?: string[];
}

const prefsPath = () => process.env.VELLOO_PREFS_PATH ?? join(homedir(), ".velloo", "prefs.json");

async function readAll(): Promise<UserPrefsFile> {
  try {
    const raw = JSON.parse(await readFile(prefsPath(), "utf8")) as UserPrefsFile;
    if (raw.version === 1) return raw;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: 1 };
}

async function update(patch: Omit<Partial<UserPrefsFile>, "version">): Promise<void> {
  const next: UserPrefsFile = { ...(await readAll()), ...patch, version: 1 };
  const path = prefsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/** This machine's contact consent. False unless the person opted in here. */
export async function readFeedbackContactOk(): Promise<boolean> {
  return (await readAll()).feedbackContactOk === true;
}

export async function writeFeedbackContactOk(contactOk: boolean): Promise<void> {
  await update({ feedbackContactOk: contactOk });
}

/** The canvas preferences that outlive a run, as the canvas reads them. */
export interface CanvasUserPrefs {
  hintsSeen: string[];
}

const hintsSeen = (file: UserPrefsFile): string[] =>
  Array.isArray(file.canvasHintsSeen)
    ? file.canvasHintsSeen.filter((id): id is string => typeof id === "string")
    : [];

export async function readCanvasUserPrefs(): Promise<CanvasUserPrefs> {
  return { hintsSeen: hintsSeen(await readAll()) };
}

/**
 * Dismissing adds to the list rather than replacing it, so two canvases open
 * at once can't undo each other's dismissals.
 */
export async function writeCanvasUserPrefs(patch: {
  dismissHints?: string[] | undefined;
  resetHints?: boolean | undefined;
}): Promise<void> {
  const seen = patch.resetHints ? [] : hintsSeen(await readAll());
  const next = [...new Set([...seen, ...(patch.dismissHints ?? [])])];
  if (patch.resetHints || patch.dismissHints) await update({ canvasHintsSeen: next });
}
