import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CloudCredential {
  token: string;
  email: string;
}

interface CredentialsFile {
  version: 1;
  clouds: Record<string, CloudCredential>;
}

const credentialsPath = () =>
  process.env.VELLOO_CREDENTIALS_PATH ?? join(homedir(), ".velloo", "credentials.json");

export const normalizeCloudUrl = (url: string) => url.replace(/\/+$/, "");

async function readAll(): Promise<CredentialsFile> {
  try {
    const raw = JSON.parse(await readFile(credentialsPath(), "utf8")) as CredentialsFile;
    if (raw.version === 1 && raw.clouds) return raw;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: 1, clouds: {} };
}

export async function loadCredential(cloudUrl: string): Promise<CloudCredential | null> {
  const all = await readAll();
  return all.clouds[normalizeCloudUrl(cloudUrl)] ?? null;
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  return path;
}
