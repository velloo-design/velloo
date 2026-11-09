import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test file gets a temp directory of its own, and whatever it leaves
// under tmpdir() goes when it ends — a child's leftovers too when it was
// spawned with process.env (Bun.spawn without `env` passes the environment
// Bun started with). Leftovers used to pile up in the system temp directory
// by the hundred thousand, and Bun reads the directories above a script it
// starts or a module it bundles: an agent stand-in launched from a temp
// folder took most of a second to start instead of 10 ms, and --parallel
// runs hit the 5 s test timeout. --parallel runs the preload again for each
// file, with a fresh environment.
const scratch = mkdtempSync(join(tmpdir(), "velloo-test-"));
// os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows.
process.env.TMPDIR = scratch;
process.env.TEMP = scratch;
process.env.TMP = scratch;
afterAll(() => {
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Still held open by a process the file started (Windows). One directory
    // left behind isn't worth failing the file over.
  }
});

function scratchDir(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir);
  return dir;
}

// Local design records live in the user's ~/.velloo, and reading one can
// rewrite it (the development-build record migration). A test that resolves
// designs without choosing its own storage must never reach the real one, so
// every run defaults to a throwaway directory. Tests that set their own keep it.
process.env.VELLOO_DESIGNS_HOME ??= scratchDir("designs");
// The same goes for the person's prefs (feedback consent, the canvas tour).
process.env.VELLOO_PREFS_PATH ??= join(scratchDir("prefs"), "prefs.json");

// Colour is decided by the environment, not the test: picocolors turns it on
// whenever CI is set, even with no TTY, so text assertions that pass locally
// failed in CI on ANSI codes. Tests see plain text everywhere, and child
// processes inherit it. A test about colour sets FORCE_COLOR and deletes NO_COLOR.
process.env.NO_COLOR ??= "1";
