import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Stub biome.json controlling the rules applied to emitted code, regardless
 * of the host repo's own biome.json. Resolves from source (next to this
 * package) and from the bundled CLI (`<dist>/pkgs/codegen/biome.codegen.json`). */
function resolveBiomeConfig(): string {
  const dev = join(here, "..", "biome.codegen.json");
  const bundled = join(here, "pkgs", "codegen", "biome.codegen.json");
  return existsSync(bundled) ? bundled : dev;
}
const BIOME_CONFIG_PATH = resolveBiomeConfig();

export interface FormatError {
  stage: "format" | "lint" | "parse";
  message: string;
}
export interface FormatResult {
  output: string;
  errors: FormatError[];
}

/** Pinned biome for the spawn below — keep in sync with the workspace's
 * @biomejs/biome. Unpinned, an end-user install (where biome is not a velloo
 * dependency — a ~25MB-per-platform native binary isn't worth shipping for a
 * CSS formatting pass) would have bunx fetch *latest*, so emitted formatting
 * could drift between machines. Pinned, bunx resolves the local install when
 * present and caches the download otherwise. */
const BIOME_PIN = "@biomejs/biome@2.5.4";

async function runBiome(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn(["bunx", BIOME_PIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  await new Response(proc.stdout).text(); // drain
  const exitCode = await proc.exited;
  return { exitCode, stderr };
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
