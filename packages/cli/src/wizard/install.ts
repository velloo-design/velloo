import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { noLibVersion } from "@velloo/provider-none";
import type { Library } from "@velloo/schema";
import { type InstalledSnapshot, installSnapshot, snapshotVersion } from "@velloo/shadcn-snapshot";
import type { WizardAnswers } from "./answers.ts";

export interface InstallPlan {
  /** Library config to persist to `.design/config.json`. */
  library: Library;
  /** Provider files copied (when source !== "binary"). */
  installed: InstalledSnapshot | null;
  /**
   * Human-readable summary printed at the end of init — "Library: shadcn (2026.05.22)"
   * plus where the components landed.
   */
  summary: { name: string; location: string };
}

/**
 * Resolve the wizard's answers into a concrete install + library
 * declaration. For `source === "binary"` no files are written; for
 * `in-repo` and `cache` we copy the snapshot sources to the chosen
 * destination and record the resolved path in `library.componentsPath`.
 */
export async function executeInstall(
  answers: WizardAnswers,
  projectId: string,
): Promise<InstallPlan> {
  if (answers.library === "none") {
    return {
      library: {
        id: "none",
        version: noLibVersion,
        source: "binary",
        componentsPath: "binary",
      },
      installed: null,
      summary: {
        name: `no-library primitives (${noLibVersion})`,
        location: "bundled with velloo",
      },
    };
  }

  if (answers.library === "mui") {
    // Mirrors the loader's error so users see the same message
    // whether they hit it via init or via `velloo run`.
    throw new Error(
      [
        "the MUI provider is scaffolded but not yet vendored.",
        "Track in docs/roadmap.md under Sprint X+2.1.",
        "Use --library=shadcn-react (default) or --library=none for now.",
      ].join("\n"),
    );
  }

  if (answers.source === "binary") {
    return {
      library: {
        id: "shadcn-react",
        version: snapshotVersion,
        source: "binary",
        componentsPath: "binary",
      },
      installed: null,
      summary: { name: `shadcn (${snapshotVersion})`, location: "bundled with velloo" },
    };
  }

  if (answers.source === "in-repo") {
    if (!answers.appPath) {
      throw new Error("in-repo install requires --app-path / `appPath`.");
    }
    const absDest = resolve(answers.appPath, answers.componentsRelative);
    await mkdir(absDest, { recursive: true });
    const installed = await installSnapshot({ destination: absDest });
    // Path stored in the config is relative to the design folder so
    // the config travels well across machines (git clones, dotfile syncs).
    const rel = relative(answers.folder, absDest);
    return {
      library: {
        id: "shadcn-react",
        version: snapshotVersion,
        source: "in-repo",
        componentsPath: rel || ".",
      },
      installed,
      summary: { name: `shadcn (${snapshotVersion})`, location: absDest },
    };
  }

  // source === "cache"
  const cacheRoot = join(homedir(), ".velloo", projectId, "components");
  const installed = await installSnapshot({ destination: cacheRoot });
  return {
    library: {
      id: "shadcn-react",
      version: snapshotVersion,
      source: "cache",
      // Cache paths are absolute (no relative round-tripping makes sense
      // across machines) but we leave the `~/` form so the file's intent
      // is readable when a human opens config.json.
      componentsPath: `~/.velloo/${projectId}/components`,
    },
    installed,
    summary: { name: `shadcn (${snapshotVersion})`, location: cacheRoot },
  };
}
