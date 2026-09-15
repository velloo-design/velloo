#!/usr/bin/env bun
/**
 * Runs the same CodeQL analysis GitHub's default code-scanning setup runs on
 * this repo, locally, so an alert is found before the push instead of after.
 *
 *   bun run codeql
 *
 * Needs the CodeQL CLI (`brew install --cask codeql`). The JavaScript query
 * pack is downloaded on first use. Takes ~30s on a warm machine.
 *
 * Findings already dismissed on GitHub are hidden when `gh` can reach the
 * repo. They are matched by rule and file, not line: a dismissed test-only
 * finding moves every time the file above it changes.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const QUERY_PACK = "codeql/javascript-queries";
const SUITE = `${QUERY_PACK}:codeql-suites/javascript-code-scanning.qls`;

function run(cmd: string, args: string[], quiet = true): { ok: boolean; stdout: string } {
  const r = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    if (quiet) process.stderr.write(`${r.stderr ?? ""}${r.error?.message ?? ""}\n`);
    return { ok: false, stdout: r.stdout ?? "" };
  }
  return { ok: true, stdout: r.stdout ?? "" };
}

function fail(message: string): never {
  process.stderr.write(`codeql: ${message}\n`);
  process.exit(2);
}

if (spawnSync("codeql", ["version"], { stdio: "ignore" }).error) {
  fail("the CodeQL CLI is not installed — `brew install --cask codeql`");
}

if (!run("codeql", ["resolve", "queries", SUITE]).ok) {
  process.stderr.write(`codeql: downloading ${QUERY_PACK}…\n`);
  if (!run("codeql", ["pack", "download", QUERY_PACK], false).ok)
    fail("query pack download failed");
}

interface SarifResult {
  ruleId: string;
  message: { text: string };
  locations: Array<{
    physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } };
  }>;
}

/** `rule path` keys of alerts dismissed on GitHub; empty when gh can't answer. */
function dismissedKeys(): Set<string> {
  const r = run("gh", [
    "api",
    "--paginate",
    "repos/{owner}/{repo}/code-scanning/alerts?state=dismissed&per_page=100",
    "--jq",
    '.[] | "\\(.rule.id) \\(.most_recent_instance.location.path)"',
  ]);
  if (!r.ok) {
    process.stderr.write(
      "codeql: couldn't read dismissed alerts from GitHub; showing everything\n",
    );
    return new Set();
  }
  return new Set(r.stdout.split("\n").filter(Boolean));
}

const work = mkdtempSync(join(tmpdir(), "velloo-codeql-"));
try {
  const db = join(work, "db");
  const sarif = join(work, "results.sarif");
  process.stderr.write("codeql: building database…\n");
  if (
    !run("codeql", [
      "database",
      "create",
      db,
      "--language=javascript-typescript",
      `--source-root=${repoRoot}`,
      "--threads=0",
    ]).ok
  ) {
    fail("database create failed");
  }
  process.stderr.write("codeql: analyzing…\n");
  if (
    !run("codeql", [
      "database",
      "analyze",
      db,
      SUITE,
      "--format=sarif-latest",
      `--output=${sarif}`,
      "--threads=0",
    ]).ok
  ) {
    fail("analysis failed");
  }

  const parsed = JSON.parse(readFileSync(sarif, "utf8")) as {
    runs: Array<{ results: SarifResult[] }>;
  };
  const dismissed = dismissedKeys();
  const findings = [
    ...new Set(
      (parsed.runs[0]?.results ?? []).flatMap((r) => {
        const loc = r.locations[0]?.physicalLocation;
        if (!loc) return [];
        const path = loc.artifactLocation.uri;
        if (dismissed.has(`${r.ruleId} ${path}`)) return [];
        return [`${path}:${loc.region.startLine}  ${r.ruleId}\n  ${r.message.text.split("\n")[0]}`];
      }),
    ),
  ];

  if (findings.length === 0) {
    process.stderr.write("codeql: no open findings\n");
  } else {
    process.stdout.write(`${findings.join("\n")}\n`);
    process.stderr.write(`codeql: ${findings.length} finding(s)\n`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
