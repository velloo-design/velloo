import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

/**
 * The credentials file is hand-editable, shared across velloo versions, and
 * holds bearer tokens — so it is parsed rather than asserted. A malformed
 * entry read as a good one sends a garbage Authorization header to the cloud;
 * an unreadable file simply starts fresh, which is what a missing one does.
 */
const CloudCredentialSchema = z.object({
  token: z.string().min(1),
  email: z.string().min(1),
});
export type CloudCredential = z.infer<typeof CloudCredentialSchema>;

const CredentialsFileSchema = z.object({
  version: z.literal(1),
  clouds: z.record(z.string(), CloudCredentialSchema),
});
type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

const credentialsPath = () =>
  process.env.VELLOO_CREDENTIALS_PATH ?? join(homedir(), ".velloo", "credentials.json");

export const normalizeCloudUrl = (url: string) => url.replace(/\/+$/, "");

async function readAll(): Promise<CredentialsFile> {
  try {
    const parsed = CredentialsFileSchema.safeParse(
      JSON.parse(await readFile(credentialsPath(), "utf8")),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: 1, clouds: {} };
}

export async function loadCredential(cloudUrl: string): Promise<CloudCredential | null> {
  const all = await readAll();
  return all.clouds[normalizeCloudUrl(cloudUrl)] ?? null;
}

/** Every saved credential, keyed by cloud URL. */
export async function listCredentials(): Promise<Record<string, CloudCredential>> {
  return (await readAll()).clouds;
}

export async function saveCredential(cloudUrl: string, cred: CloudCredential): Promise<string> {
  const all = await readAll();
  all.clouds[normalizeCloudUrl(cloudUrl)] = cred;
  return writeAll(all);
}

/** Drop the saved credential for one cloud. Returns false if none was stored. */
export async function deleteCredential(cloudUrl: string): Promise<boolean> {
  const all = await readAll();
  const key = normalizeCloudUrl(cloudUrl);
  if (!(key in all.clouds)) return false;
  delete all.clouds[key];
  await writeAll(all);
  return true;
}

/** Drop every saved credential. Returns how many clouds were cleared. */
export async function clearCredentials(): Promise<number> {
  const all = await readAll();
  const count = Object.keys(all.clouds).length;
  if (count === 0) return 0;
  await writeAll({ version: 1, clouds: {} });
  return count;
}

async function writeAll(all: CredentialsFile): Promise<string> {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  // writeFile's mode only applies when it creates the file — re-assert so a
  // pre-existing looser credentials file tightens to owner-only on every write.
  await chmod(path, 0o600);
  return path;
}
