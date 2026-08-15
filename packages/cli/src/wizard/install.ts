import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { noLibVersion } from "@velloo/provider-none";
import { installShadcnUpstream } from "@velloo/provider-shadcn-upstream";
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
  /**
   * Optional npm dependencies the user's app needs to install (e.g.
   * `@radix-ui/react-slot`). The Sprint-Z upstream provider populates
   * this; legacy paths leave it empty. The wizard echoes this list to
   * the post-init summary.
   */
  npmDependencies?: string[];
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

  if (answers.library === "shadcn-upstream") {
    return executeUpstreamInstall(answers, projectId);
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

/**
 * Sprint Z install path for shadcn-upstream. The user's choice of
 * `in-repo` / `cache` decides the destination directory exactly like
 * the legacy path; the install machinery is the upstream fetcher
 * (`@velloo/provider-shadcn-upstream`) instead of the snapshot
 * copier. Result: byte-identical vanilla shadcn lands in the chosen
 * location, plus a manifest the canvas's inspector reads at boot.
 */
async function executeUpstreamInstall(
  answers: WizardAnswers,
  projectId: string,
): Promise<InstallPlan> {
  if (answers.source === "binary") {
    // No on-disk install — the canvas uses the snapshot-equivalent
    // registry baked into the binary. Useful for offline + greenfield
    // explorations; the user can later run the cache/in-repo install
    // to drop vanilla shadcn into their app.
    return {
      library: {
        id: "shadcn-upstream",
        version: snapshotVersion,
        source: "binary",
        componentsPath: "binary",
      },
      installed: null,
      summary: {
        name: `shadcn (upstream, no on-disk install)`,
        location: "bundled with velloo",
      },
    };
  }

  // Pick the destination. `in-repo` writes into the user's app; `cache`
  // writes under ~/.velloo so the install is isolated from any host
  // codebase (useful when the design folder ships in greenfield).
  let destination: string;
  let componentsPath: string;
  if (answers.source === "in-repo") {
    if (!answers.appPath) {
      throw new Error("in-repo install requires --app-path / `appPath`.");
    }
    // shadcn's `ui/` subfolder is added by the fetcher; we point at
    // the parent so the resulting layout matches what `npx shadcn add`
    // produces (`src/components/ui/*.tsx`).
    destination = resolve(answers.appPath, answers.componentsRelative.replace(/\/ui$/, ""));
    await mkdir(destination, { recursive: true });
    const rel = relative(answers.folder, destination);
    componentsPath = rel || ".";
  } else {
    destination = join(homedir(), ".velloo", "providers", `shadcn-upstream-${projectId}`);
    componentsPath = `~/.velloo/providers/shadcn-upstream-${projectId}`;
  }

  const result = await installShadcnUpstream({ destination });
  return {
    library: {
      id: "shadcn-upstream",
      version: result.lock.version,
      source: answers.source,
      componentsPath,
    },
    installed: null,
    summary: {
      name: `shadcn (upstream @ ${result.lock.version})`,
      location: destination,
    },
    npmDependencies: result.npmDependencies,
  };
}
