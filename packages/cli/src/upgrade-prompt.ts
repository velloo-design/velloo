import { confirm, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { installedVellooBin } from "./release.ts";
import { updateStatus, upgradeInstalledVelloo } from "./update.ts";

/**
 * Offer the pending update before a long interactive flow commits to anything.
 *
 * `velloo init` writes a design folder stamped with the running build and
 * installs agent skills from it, so starting one on a stale binary means
 * redoing both. This is the one place velloo checks for a release in the
 * foreground rather than reporting yesterday's cached answer — the wizard is
 * about to take minutes, so a two-second check is affordable, and a check that
 * fails must never be the reason `init` doesn't run.
 *
 * Returns true when the caller should stop: either the new binary has taken
 * over the command (it was re-executed) or the user must re-run it.
 */
export async function offerUpgradeBeforeInit(argv: string[]): Promise<boolean> {
  if (process.env.VELLOO_DISABLE_UPDATE_CHECK === "1" || !process.stdin.isTTY) return false;

  let status: Awaited<ReturnType<typeof updateStatus>>;
  try {
    status = await updateStatus({ refresh: true });
  } catch {
    return false;
  }
  if (!status.available || !status.upgradable || !status.latest) return false;

  console.log("");
  console.log(
    `${pc.yellow("A newer velloo is available:")} ${status.current} → ${pc.bold(status.latest)}`,
  );
  const yes = await confirm({
    message: "Upgrade before setting up this design folder?",
    initialValue: true,
  });
  if (isCancel(yes) || !yes) {
    console.log(pc.dim("  Continuing on the current version."));
    return false;
  }

  try {
    const outcome = await upgradeInstalledVelloo();
    if (!outcome.upgraded) return false;
    const bin = installedVellooBin();
    if (!bin) {
      console.log(pc.dim("  Upgraded. Run `velloo init` again to continue on the new version."));
      return true;
    }
    // Hand the wizard to the build that was just installed: the folder it
    // scaffolds should be stamped, and its skills written, by that one.
    const code = await Bun.spawn([bin, ...argv], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, VELLOO_DISABLE_UPDATE_CHECK: "1" },
    }).exited;
    process.exit(code);
  } catch (error) {
    console.log(
      pc.yellow(
        `  Could not upgrade (${error instanceof Error ? error.message : String(error)}) — continuing on the current version.`,
      ),
    );
    return false;
  }
}
