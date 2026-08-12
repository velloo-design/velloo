import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
/** Stub biome.json living next to this file — controls the rules applied to
 * emitted code, regardless of the host repo's own biome.json. */
const BIOME_CONFIG_PATH = join(here, "..", "biome.codegen.json");

export interface FormatError {
  stage: "format" | "lint" | "parse";
  message: string;
}
export interface FormatResult {
  output: string;
  errors: FormatError[];
}

async function runBiome(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(["bunx", "@biomejs/biome", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await new Response(proc.stdout).text(); // drain
  const exitCode = await proc.exited;
  return { exitCode, stderr };
}

/**
 * Format an emitted .tsx string through Biome's CLI (format + lint), then
 * parse it with the TypeScript compiler API. Returns the final string plus a
 * list of any errors; callers decide whether to surface them.
 */
export async function formatTsx(filePath: string, source: string): Promise<FormatResult> {
  const errors: FormatError[] = [];
  const tmp = await mkdtemp(join(tmpdir(), "velloo-codegen-"));
  const onDisk = join(tmp, filePath.replace(/[/\\]/g, "_"));
  await writeFile(onDisk, source, "utf8");

  try {
    // 1. Format in place.
    const fmt = await runBiome(["format", "--write", `--config-path=${BIOME_CONFIG_PATH}`, onDisk]);
    if (fmt.exitCode !== 0 && fmt.stderr) {
      errors.push({ stage: "format", message: trimDiagnostics(fmt.stderr) });
    }
    // 2. Lint (read-only — don't autofix, since the safety net should *flag*).
    const lint = await runBiome(["lint", `--config-path=${BIOME_CONFIG_PATH}`, onDisk]);
    if (lint.exitCode !== 0 && lint.stderr) {
      errors.push({ stage: "lint", message: trimDiagnostics(lint.stderr) });
    }
    const formatted = await readFile(onDisk, "utf8");

    // 3. TS parse — last defense against the emitter writing garbage.
    const sf = ts.createSourceFile(
      filePath,
      formatted,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );
    const parseDiags =
      (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
    for (const d of parseDiags) {
      if (d.category === ts.DiagnosticCategory.Error) {
        errors.push({
          stage: "parse",
          message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        });
      }
    }

    return { output: formatted, errors };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Format a CSS file. Biome formats CSS too; lint is mostly a no-op here. */
export async function formatCss(filePath: string, source: string): Promise<FormatResult> {
  const errors: FormatError[] = [];
  const tmp = await mkdtemp(join(tmpdir(), "velloo-codegen-"));
  const onDisk = join(tmp, filePath.replace(/[/\\]/g, "_"));
  await writeFile(onDisk, source, "utf8");
  try {
    const fmt = await runBiome(["format", "--write", `--config-path=${BIOME_CONFIG_PATH}`, onDisk]);
    if (fmt.exitCode !== 0 && fmt.stderr) {
      // CSS-with-Tailwind directives confuses Biome's CSS parser; emit as a
      // warning rather than failing the whole emit. We keep the un-formatted
      // source instead of erroring out.
      errors.push({ stage: "format", message: trimDiagnostics(fmt.stderr) });
      return { output: source, errors };
    }
    const formatted = await readFile(onDisk, "utf8");
    return { output: formatted, errors };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI color escape codes are this pattern's literal target.
const ANSI_COLOR_RE = /\x1b\[[0-9;]*m/g;

function trimDiagnostics(stderr: string): string {
  return stderr.replace(ANSI_COLOR_RE, "").trim().slice(0, 800);
}
