import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Local design records live in the user's ~/.velloo, and reading one can
// rewrite it (the development-build record migration). A test that resolves
// designs without choosing its own storage must never reach the real one, so
// every run defaults to a throwaway directory. Tests that set their own keep it.
process.env.VELLOO_DESIGNS_HOME ??= mkdtempSync(join(tmpdir(), "velloo-test-designs-"));

// Colour is decided by the environment, not the test: picocolors turns it on
// whenever CI is set, even with no TTY, so text assertions that pass locally
// failed in CI on ANSI codes. Tests see plain text everywhere, and child
// processes inherit it. A test about colour sets FORCE_COLOR and deletes NO_COLOR.
process.env.NO_COLOR ??= "1";
