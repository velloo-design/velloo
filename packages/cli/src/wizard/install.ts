import { resolve } from "node:path";
import { MUI_VERSION } from "@velloo/provider-mui";
import { noLibVersion } from "@velloo/provider-none";
import type { Library } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import type { WizardAnswers } from "./answers.ts";

export interface InstallPlan {
  /** Library config to persist to `.design/config.json`. */
  library: Library;
  /** Human-readable summary printed at the end of init. */
  summary: { name: string; location: string };
  /**
   * Set when the user chose shadcn-upstream: the real vanilla-shadcn install
   * is deferred to the post-init agent handoff so init never touches the
   * user's app. Carries where those components should land.
   */
  pendingUpstream?: { targetDir: string; relative: string };
}

/**
 * Resolve the wizard's answers into a library declaration. Init is
 * **non-destructive**: it writes nothing into the user's app and copies no
 * components to disk. Every fresh folder renders from the snapshot baked
 * into the binary (`source: "binary"`); for shadcn-upstream the intended
 * in-app component location is recorded as `pendingUpstream` and the actual
 * fetch is left to the post-init agent step. Canvas-fork files never leave
 * the velloo package.
 */
export function planInstall(answers: WizardAnswers): InstallPlan {
  if (answers.library === "mui") {
    // Framework-native: MUI is a first-class adapter bundled with velloo
    // (@mui/material + emotion are velloo deps; components SSR in-process). See
    // docs/framework-native.md.
    return {
      library: { id: "mui", version: MUI_VERSION, source: "binary", componentsPath: "binary" },
      summary: { name: `Material UI v${MUI_VERSION}`, location: "bundled with velloo" },
    };
  }

  if (answers.library === "none") {
    return {
      library: { id: "none", version: noLibVersion, source: "binary", componentsPath: "binary" },
      summary: { name: `no-library primitives (${noLibVersion})`, location: "bundled with velloo" },
    };
  }

  const library: Library = {
    id: answers.library,
    version: snapshotVersion,
    source: "binary",
    componentsPath: "binary",
  };

  if (answers.library === "shadcn-upstream") {
    const targetDir = resolve(answers.appRoot, answers.componentsRelative);
    return {
      library,
      summary: {
        name: "shadcn (upstream)",
        location: `canvas uses the bundled snapshot; real components added to ${answers.componentsRelative} on setup`,
      },
      pendingUpstream: { targetDir, relative: answers.componentsRelative },
    };
  }

  return {
    library,
    summary: { name: `shadcn (${snapshotVersion})`, location: "bundled with velloo" },
  };
}
