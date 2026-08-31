#!/usr/bin/env bun
/**
 * Watch the sources that go into the velloo bundle and re-run `cli:install` on
 * every change — the dogfooding loop for the *installed* binary, where
 * `bun run velloo` (from source) isn't what you want to exercise. Run:
 *
 *   bun run cli:watch
 *
 * A rebuild is the full install (canvas + cli + skills + tarball + global
 * install), so it costs real seconds. Changes are therefore debounced, and a
 * change arriving mid-build queues exactly one more run rather than piling up.
 */
import { existsSync, statSync, watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * What actually ends up in the bundle. Deliberately not the repo root: watching
 * everything would fire on node_modules churn, git operations, and the build's
 * own output (which would loop).
 */
const WATCHED = ["packages", "skills", "plugins"].filter((d) => existsSync(join(repoRoot, d)));

/** Build output and dependency trees — noise that would rebuild forever. */
const IGNORED = /(^|[/\\])(node_modules|dist|\.git|\.turbo|coverage)([/\\]|$)|\.tgz$/;

const DEBOUNCE_MS = 400;

/**
 * macOS FSEvents reports a path when the build merely *reads* it — the bundler
 * copies `packages/helpers/src/icon-data.ts` into the CLI dist, and that copy
 * surfaces as a change event for the source. Taking those at face value makes
 * the build retrigger itself forever, so an event only counts when the file's
 * mtime is actually newer than the build that would have produced it.
 */
function changedSince(paths: Iterable<string>, since: number): string | null {
  for (const rel of paths) {
    try {
      if (statSync(join(repoRoot, rel)).mtimeMs > since) return rel;
    } catch {
      return rel; // gone — a deletion is a real change
    }
  }
  return null;
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

let building = false;
let queued = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Paths that fired since the last decision, checked against mtimes as a batch. */
let pending = new Set<string>();
/** When the last build began — the cutoff for "is this edit actually newer?". */
let lastBuildStartedAt = 0;

async function build(reason: string): Promise<void> {
  if (building) {
    // Collapse everything that lands mid-build into a single follow-up run.
    queued = true;
    return;
  }
  building = true;
  const started = Date.now();
  lastBuildStartedAt = started;
  console.log(`\n${dim("─".repeat(60))}`);
  console.log(`${dim(new Date().toLocaleTimeString())} rebuilding — ${reason}`);
  const proc = Bun.spawn(["bun", join(repoRoot, "scripts", "cli-install.ts")], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const code = await proc.exited;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    code === 0
      ? green(`✓ installed in ${secs}s`) + dim("  — watching for changes…")
      : red(`✗ build failed (exit ${code})`) + dim("  — watching for changes…"),
  );
  building = false;
  if (queued) {
    queued = false;
    void build("changes during the last build");
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const batch = pending;
    pending = new Set();
    const changed = changedSince(batch, lastBuildStartedAt);
    if (changed === null) return; // build noise, not an edit
    void build(changed);
  }, DEBOUNCE_MS);
}

console.log(`velloo cli:watch — watching ${WATCHED.join(", ")}`);
console.log(dim("  every change rebuilds the bundle and reinstalls it globally. Ctrl-C to stop."));

for (const dir of WATCHED) {
  watch(join(repoRoot, dir), { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = join(dir, filename.toString());
    if (IGNORED.test(rel)) return;
    pending.add(rel);
    schedule();
  });
}

// Build once up front so the installed binary matches the tree you're editing.
void build("initial build");
