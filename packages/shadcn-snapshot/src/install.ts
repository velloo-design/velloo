import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { componentsDir, entryCssPath, snapshotVersion } from "./paths.ts";

/**
 * What a successful snapshot install produces on disk. The provider
 * loader records this in `.design/config.json#library` so subsequent
 * `velloo run` invocations know where the files live.
 */
export interface InstalledSnapshot {
  /** Provider id ("shadcn-react"). */
  providerId: "shadcn-react";
  /** Snapshot version, e.g. "2026.05.22". */
  version: string;
  /** Absolute path of the directory holding the component sources. */
  destination: string;
  /** Files copied (relative to destination), useful for diff/upgrade reporting. */
  files: string[];
}

interface InstallOptions {
  /**
   * Absolute destination for the component sources. The caller picks
   * this — typically `<app>/src/components/ui` for in-repo mode or
   * `~/.velloo/<projectId>/components` for cache mode.
   */
  destination: string;
  /**
   * When true, overwrite existing files at the destination. Default
   * false: collisions are skipped (the existing file wins) so the
   * installer is idempotent and safe to re-run.
   */
  force?: boolean;
}

async function walkTsxFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
  }
  await visit(root);
  out.sort();
  return out;
}

async function exists(path: string): Promise<boolean> {
  const f = Bun.file(path);
  return await f.exists();
}

/**
 * Copy the snapshot's component sources + entry CSS to a destination
 * on disk. Returns an `InstalledSnapshot` describing what was written.
 *
 * The runtime registry stays bundled inside the velloo binary — this
 * install is for the *user's app* to consume (so the user can `import`
 * from `<destination>/button.tsx` and have the same component file the
 * canvas renders). The Tailwind JIT still scans the binary's
 * `componentsDir` so what the canvas displays matches the registry.
 */
export async function installSnapshot(opts: InstallOptions): Promise<InstalledSnapshot> {
  const destination = opts.destination;
  await mkdir(destination, { recursive: true });

  const sources = await walkTsxFiles(componentsDir);
  const written: string[] = [];

  for (const src of sources) {
    const rel = relative(componentsDir, src);
    const dest = join(destination, rel);
    const destDir = dirname(dest);
    await mkdir(destDir, { recursive: true });
    if (!opts.force && (await exists(dest))) continue;
    await copyFile(src, dest);
    written.push(rel);
  }

  // Drop the entry CSS alongside the components — apps that haven't
  // yet integrated Tailwind v4 can use it as a starting point, and
  // `velloo theme:export` writes the diff against this baseline.
  const entryDest = join(destination, basename(entryCssPath));
  if (opts.force || !(await exists(entryDest))) {
    await copyFile(entryCssPath, entryDest);
    written.push(basename(entryCssPath));
  }

  // Provenance marker. Future `velloo upgrade` reads this to compute
  // the diff between the on-disk version and the binary's version.
  const provenance = {
    providerId: "shadcn-react" as const,
    version: snapshotVersion,
    installedAt: new Date().toISOString(),
    files: written,
  };
  const provenancePath = join(destination, "provider.json");
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

  return {
    providerId: "shadcn-react",
    version: snapshotVersion,
    destination,
    files: written,
  };
}
