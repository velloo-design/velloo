import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitDesignMdContents, markdownSections } from "@velloo/codegen";
import { unwrap } from "@velloo/result";
import { designTheme, testContext } from "../../testing/design-folder.ts";
import { mapDesignMd } from "../import-design-md.ts";
import { importThemeDesignMd } from "../index.ts";

/**
 * The core DESIGN.md flow, checked against the format's own authority: import
 * a file Google ships, emit one back, and have `@google/design.md lint` accept
 * it. Everything else in this milestone tests velloo's opinion of the spec;
 * this is the one test that asks the spec.
 *
 * Opt-in (`VELLOO_E2E=1`) because it shells out to `npx`, which needs the
 * network and a warm npm cache.
 */
const RUN = process.env.VELLOO_E2E === "1";

const FIXTURES = join(import.meta.dir, "fixtures", "design-md");
const EXAMPLES = ["paws-and-paths", "atmospheric-glass", "totality-festival"] as const;

interface LintReport {
  findings: { severity: string; rule?: string; message: string }[];
  summary: { errors: number; warnings: number; infos: number };
}

async function lint(file: string): Promise<LintReport> {
  const proc = Bun.spawn(["npx", "--yes", "@google/design.md@0.4.0", "lint", file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  // npx prints notices before the JSON body.
  const start = out.indexOf("{");
  if (start === -1) throw new Error(`no lint JSON in output: ${out.slice(0, 400)}`);
  return JSON.parse(out.slice(start)) as LintReport;
}

const problems = (r: LintReport) => r.findings.filter((f) => f.severity !== "info");

describe.skipIf(!RUN)("DESIGN.md round trip, linted by @google/design.md", () => {
  test(
    "every emitted file is accepted with no errors and no warnings",
    async () => {
      const out = await mkdtemp(join(tmpdir(), "velloo-designmd-lint-"));
      try {
        for (const name of EXAMPLES) {
          const source = await readFile(join(FIXTURES, `${name}.DESIGN.md`), "utf8");
          const imported = unwrap(mapDesignMd(designTheme(), source));
          const emitted = emitDesignMdContents(imported.theme, {
            name,
            prose: markdownSections(source),
          });
          const file = join(out, `${name}.DESIGN.md`);
          await writeFile(file, emitted.contents, "utf8");

          const report = await lint(file);
          expect({ name, problems: problems(report) }).toEqual({ name, problems: [] });
          expect(report.summary.errors).toBe(0);
          expect(report.summary.warnings).toBe(0);
        }
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    },
    { timeout: 180_000 },
  );

  test(
    "a light/dark theme emits two files and both pass",
    async () => {
      const out = await mkdtemp(join(tmpdir(), "velloo-designmd-lint-dark-"));
      const t = await testContext({ label: "designmd-e2e" });
      try {
        // Two DESIGN.md files compose into one theme-flipping velloo theme —
        // the thing the format itself cannot express.
        await importThemeDesignMd(
          t.ctx,
          await readFile(join(FIXTURES, "paws-and-paths.DESIGN.md"), "utf8"),
          {
            apply: true,
          },
        );
        await importThemeDesignMd(
          t.ctx,
          await readFile(join(FIXTURES, "atmospheric-glass.DESIGN.md"), "utf8"),
          { apply: true, mode: "dark" },
        );
        expect(t.ctx.folder.theme.colorsDark?.background).toBeTruthy();

        const prose = markdownSections(
          await readFile(join(FIXTURES, "paws-and-paths.DESIGN.md"), "utf8"),
        );
        for (const mode of ["light", "dark"] as const) {
          const emitted = emitDesignMdContents(t.ctx.folder.theme, {
            mode,
            name: "Paws & Paths",
            prose,
          });
          const file = join(out, mode === "dark" ? "DESIGN.dark.md" : "DESIGN.md");
          await writeFile(file, emitted.contents, "utf8");
          const report = await lint(file);
          expect({ mode, problems: problems(report) }).toEqual({ mode, problems: [] });
        }
      } finally {
        await t.cleanup();
        await rm(out, { recursive: true, force: true });
      }
    },
    { timeout: 180_000 },
  );

  test(
    "the vendored fixtures themselves still lint clean upstream",
    async () => {
      // If this fails, the spec moved under the fixtures — which is exactly
      // what the conformance suite exists to catch early.
      for (const name of EXAMPLES) {
        const report = await lint(join(FIXTURES, `${name}.DESIGN.md`));
        expect({ name, errors: report.summary.errors }).toEqual({ name, errors: 0 });
      }
    },
    { timeout: 180_000 },
  );
});
