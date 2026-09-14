import { resolve } from "node:path";
import { managedProjectContext } from "@velloo/server";
import pc from "picocolors";
import { askAgentWiring } from "../../connect/index.ts";
import { resolveProjectRoot } from "../../connect/project-root.ts";
import {
  inheritedFromFolder,
  promptExistingFolderAction,
  readFolderFacts,
  runCheckSetup,
  runOpenCanvas,
  runScan,
  runThemeReimport,
  runUpgrade,
} from "../../existing-folder.ts";
import { existingDesignFolder, hasDesignConfig, resolveDesignFolder } from "../../folder.ts";
import { findManifest, pickProject } from "../../manifest.ts";
import type { InitCliArgs } from "../../wizard/args.ts";
import { applyAgentWiring, NOT_WIRED, printWired } from "./agent-wiring.ts";
import { printExitInstructions } from "./output.ts";

type ExistingFolderOutcome =
  /** No design folder here yet — scaffold as usual. */
  | { kind: "none" }
  /** The user picked an action on the existing folder (or cancelled); init is done. */
  | { kind: "handled" }
  /**
   * Scaffold a second folder beside it. The app is the same one, so the
   * sibling's library + components dir carry over instead of being asked again.
   */
  | { kind: "another"; inherited: Awaited<ReturnType<typeof inheritedFromFolder>> };

/**
 * Already a Velloo design here? Don't re-run the whole scaffold wizard —
 * offer the actions that make sense on an existing folder.
 */
export async function offerExistingFolderActions(
  appRoot: string,
  cliArgs: InitCliArgs,
): Promise<ExistingFolderOutcome> {
  // With --add-folder the design-folder arg names the folder being *created*,
  // so the sibling to read defaults from is whichever one the repo already
  // has — not that path.
  const manifest = await findManifest(appRoot);
  const project = manifest ? pickProject(manifest, appRoot) : null;
  const registered =
    project && !cliArgs.designFolder
      ? await resolveDesignFolder(project, "init", { cwd: appRoot, interactive: true })
      : null;
  const existing =
    registered ??
    (cliArgs.addFolder
      ? ((await existingDesignFolder(appRoot)) ?? resolve(appRoot, "velloo"))
      : resolve(appRoot, cliArgs.designFolder ?? "velloo"));
  if (!(await hasDesignConfig(existing))) return { kind: "none" };

  const contextRoot = managedProjectContext(existing)?.appRoot ?? appRoot;
  const facts = await readFolderFacts(existing, contextRoot);
  // `velloo folder add` skips the menu — the caller already said what they
  // came for.
  const action = cliArgs.addFolder ? "another" : await promptExistingFolderAction(facts, existing);
  if (action === null || action === "cancel") {
    console.log(pc.dim("  Nothing changed."));
    return { kind: "handled" };
  }
  if (action === "connect") {
    const wiring = await askAgentWiring({
      skipWhenCovered: true,
      projectRoot: await resolveProjectRoot(existing),
    });
    const wireOutcome = wiring ? await applyAgentWiring(existing, wiring) : NOT_WIRED;
    printWired(wireOutcome);
    printExitInstructions(existing, wireOutcome);
    return { kind: "handled" };
  }
  if (action !== "another") {
    if (action === "upgrade") await runUpgrade(existing);
    if (action === "scan") await runScan(existing, contextRoot, cliArgs.scanDir);
    if (action === "theme") await runThemeReimport(existing, contextRoot);
    if (action === "check") await runCheckSetup(existing, contextRoot);
    if (action === "open") await runOpenCanvas(existing);
    return { kind: "handled" };
  }
  // "another" falls through to the normal wizard, which asks where the new
  // folder goes — and rejects a path that's already a design folder at the
  // prompt, not after the whole wizard has run.
  return { kind: "another", inherited: await inheritedFromFolder(existing) };
}
