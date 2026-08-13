import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { componentsDir, entryCssPath, snapshotVersion } from "@velloo/shadcn-snapshot";

/**
 * Library Registry — Velloo's set of supported UI libraries. Each entry knows
 * how to populate a design folder's `components/` directory with a fresh,
 * canvas-safe copy of the library.
 *
 * Sprint B: `shadcn-react` is the only entry. Its source is bundled inside
 * the Velloo binary via the @velloo/shadcn-snapshot package so init works
 * offline; future entries (Mantine, MUI, Chakra) ship the same way.
 */
export interface LibraryEntry {
  /** Stable id used in `--library <id>`. */
  id: "shadcn-react";
  /** Human label for CLI output. */
  label: string;
  /** Library version (drives `velloo upgrade` diffs). */
  version: string;
  /**
   * Absolute path to the directory of vendored .tsx files. Init copies the
   * contents into `<designFolder>/components/`.
   */
  sourceDir: string;
  /**
   * Absolute path to the Tailwind v4 entry CSS shipped with the library.
   * Init copies it into the design folder so the JIT compiler can resolve
   * it locally even if the user edits components later.
   */
  tailwindEntry: string;
  /** Auxiliary helper modules to copy (e.g. lib/utils.ts). */
  auxiliaries: { sourcePath: string; relPath: string }[];
}

export const LIBRARY_REGISTRY: Record<string, LibraryEntry> = {
  "shadcn-react": {
    id: "shadcn-react",
    label: "shadcn-react",
    version: snapshotVersion,
    sourceDir: componentsDir,
    tailwindEntry: entryCssPath,
    auxiliaries: [
      // `cn` helper used by every shadcn component.
      {
        sourcePath: join(dirname(componentsDir), "lib", "utils.ts"),
        relPath: "lib/utils.ts",
      },
    ],
  },
};

export function getLibrary(id: string): LibraryEntry {
  const entry = LIBRARY_REGISTRY[id];
  if (!entry) {
    const known = Object.keys(LIBRARY_REGISTRY).join(", ");
    throw new Error(`Unknown library: "${id}". Known libraries: ${known}.`);
  }
  return entry;
}

/**
 * Recursively walk a directory and return every regular file's path,
 * absolute. Symlinks aren't followed.
 */
async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function recurse(d: string): Promise<void> {
    const entries = await readdir(d);
    for (const name of entries) {
      const abs = join(d, name);
      const st = await stat(abs);
      if (st.isDirectory()) await recurse(abs);
      else if (st.isFile()) out.push(abs);
    }
  }
  await recurse(dir);
  return out;
}

/**
 * Copy every file under `library.sourceDir` into `<designFolder>/<componentsPath>/`,
 * preserving the directory structure. Auxiliary files land at their declared
 * relative path. The tailwind entry lands at `<designFolder>/<componentsPath>/_tailwind.css`.
 *
 * Returns the count of files copied for the CLI output.
 */
export async function pullLibraryIntoFolder(
  library: LibraryEntry,
  designFolder: string,
  componentsPath: string,
): Promise<{ filesCopied: number }> {
  const destRoot = join(designFolder, componentsPath);
  await mkdir(destRoot, { recursive: true });

  let filesCopied = 0;

  for (const abs of await walkFiles(library.sourceDir)) {
    const rel = relative(library.sourceDir, abs);
    const dest = join(destRoot, rel);
    await mkdir(dirname(dest), { recursive: true });
    if (abs.endsWith(".tsx") || abs.endsWith(".ts")) {
      const raw = await readFile(abs, "utf8");
      // Rewrite the `../../lib/utils` import emitted by shadcn primitives
      // so it resolves against the design folder's flat layout, where
      // `lib/utils.ts` sits one level up from `ui/*.tsx` and `velloo/*.tsx`.
      const rewritten = raw.replace(/\.\.\/\.\.\/lib\/utils/g, "../lib/utils");
      await writeFile(dest, rewritten, "utf8");
    } else {
      await copyFile(abs, dest);
    }
    filesCopied++;
  }

  for (const aux of library.auxiliaries) {
    const dest = join(destRoot, aux.relPath);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(aux.sourcePath, dest);
    filesCopied++;
  }

  // Tailwind entry — name it `_tailwind.css` so it sorts to the top of the
  // components dir and is obviously distinct from a component file.
  const tailwindDest = join(destRoot, "_tailwind.css");
  await copyFile(library.tailwindEntry, tailwindDest);
  filesCopied++;

  return { filesCopied };
}
