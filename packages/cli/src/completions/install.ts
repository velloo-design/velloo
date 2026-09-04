import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { completionScript, SHELLS, type Shell } from "./script.ts";
import { commandSpecs } from "./spec.ts";

/** The user's shell, from $SHELL — null when unset or unsupported. */
export function detectShell(env: NodeJS.ProcessEnv = process.env): Shell | null {
  const name = basename(env.SHELL ?? "");
  return (SHELLS as string[]).includes(name) ? (name as Shell) : null;
}

/** Marker on the rc line so re-installs stay idempotent. */
const RC_MARKER = "# velloo completions";

/**
 * Where each shell's completion artifacts live. fish autoloads from its
 * completions dir (no rc edit); zsh/bash get a script under ~/.velloo plus a
 * guarded `source` line in their rc file.
 */
function targets(shell: Shell, homeDir: string): { scriptPath: string; rcPath?: string } {
  switch (shell) {
    case "zsh":
      return {
        scriptPath: join(homeDir, ".velloo", "completions", "velloo.zsh"),
        rcPath: join(homeDir, ".zshrc"),
      };
    case "bash":
      return {
        scriptPath: join(homeDir, ".velloo", "completions", "velloo.bash"),
        rcPath: join(homeDir, ".bashrc"),
      };
    case "fish":
      return { scriptPath: join(homeDir, ".config", "fish", "completions", "velloo.fish") };
  }
}

/** Whether completions for `shell` (or any shell) are already installed. */
export function completionsInstalled(homeDir = homedir(), shell?: Shell): boolean {
  const check = shell ? [shell] : SHELLS;
  return check.some((s) => existsSync(targets(s, homeDir).scriptPath));
}

export interface CompletionsInstallResult {
  shell: Shell;
  scriptPath: string;
  /** rc file that sources the script; absent for fish (autoloaded). */
  rcPath?: string | undefined;
  /** false when the rc already carried the source line. */
  rcUpdated: boolean;
}

/**
 * Write the generated completion script and, for zsh/bash, append a guarded
 * `source` line to the shell rc (once — the marker keeps re-runs idempotent).
 * Re-running refreshes the script, so completions track the installed CLI.
 */
export async function installCompletions(
  shell: Shell,
  homeDir = homedir(),
): Promise<CompletionsInstallResult> {
  const { scriptPath, rcPath } = targets(shell, homeDir);
  const script = completionScript(shell, await commandSpecs());
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, script);

  let rcUpdated = false;
  if (rcPath) {
    const rc = await readFile(rcPath, "utf8").catch(() => "");
    if (!rc.includes(RC_MARKER)) {
      // $HOME keeps the line portable if the home dir moves; the -f guard
      // keeps a deleted script from breaking shell startup.
      const rel = scriptPath.slice(homeDir.length + 1);
      const line = `[ -f "$HOME/${rel}" ] && source "$HOME/${rel}" ${RC_MARKER}`;
      await appendFile(rcPath, `${rc.endsWith("\n") || rc === "" ? "" : "\n"}${line}\n`);
      rcUpdated = true;
    }
  }
  return { shell, scriptPath, rcPath, rcUpdated };
}
