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
  /** The canvas's first-run tour has been shown on this machine. */
  canvasTourSeen?: boolean;
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
  tourSeen: boolean;
}

export async function readCanvasUserPrefs(): Promise<CanvasUserPrefs> {
  return { tourSeen: (await readAll()).canvasTourSeen === true };
}

export async function writeCanvasUserPrefs(patch: {
  tourSeen?: boolean | undefined;
}): Promise<void> {
  if (patch.tourSeen !== undefined) await update({ canvasTourSeen: patch.tourSeen });
}
