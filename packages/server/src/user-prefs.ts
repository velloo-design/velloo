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
 */
interface UserPrefsFile {
  version: 1;
  /** Consent to be contacted about feedback sent from this machine. */
  feedbackContactOk?: boolean;
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

/** This machine's contact consent. False unless the person opted in here. */
export async function readFeedbackContactOk(): Promise<boolean> {
  return (await readAll()).feedbackContactOk === true;
}

export async function writeFeedbackContactOk(contactOk: boolean): Promise<void> {
  const next: UserPrefsFile = { ...(await readAll()), version: 1, feedbackContactOk: contactOk };
  const path = prefsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
