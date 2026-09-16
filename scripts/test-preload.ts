import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Local design records live in the user's ~/.velloo, and reading one can
// rewrite it (the development-build record migration). A test that resolves
// designs without choosing its own storage must never reach the real one, so
// every run defaults to a throwaway directory. Tests that set their own keep it.
process.env.VELLOO_DESIGNS_HOME ??= mkdtempSync(join(tmpdir(), "velloo-test-designs-"));
