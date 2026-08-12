import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { componentsDir, entryCssPath } from "@velloo/shadcn-snapshot";

type Compiler = Awaited<ReturnType<typeof compile>>;

/**
 * Tailwind v4 compiled on-demand against the snapshot components + the user's
 * live pages folder. Replaces the static safelisted CSS the snapshot used to
 * ship: anything the user (or an agent) writes as a className is generated.
 *
 * The expensive step is `compile()` (parse entry CSS, resolve @theme,
 * register @custom-variant rules). We do that once at server start and reuse
 * the returned `build(candidates)` function on every fetch — the cheap path.
 *
 * The scan + build is cached and invalidated on any page/theme change so a
 * burst of MCP edits doesn't pay the cost N times.
 */
export class TailwindJit {
  private compilerPromise: Promise<Compiler> | null = null;
  private cached: string | null = null;

  constructor(private readonly pagesDir: string) {}

  /** Drop the cached CSS so the next build() rescans the page folder. */
  invalidate(): void {
    this.cached = null;
  }

  async build(): Promise<string> {
    if (this.cached !== null) return this.cached;
    const compiler = await this.getCompiler();
    const scanner = new Scanner({
      sources: [
        { base: componentsDir, pattern: "**/*.tsx", negated: false },
        { base: this.pagesDir, pattern: "**/*.json", negated: false },
      ],
    });
    const candidates = scanner.scan();
    this.cached = compiler.build(candidates);
    return this.cached;
  }

  private getCompiler(): Promise<Compiler> {
    if (this.compilerPromise) return this.compilerPromise;
    this.compilerPromise = (async () => {
      const css = await readFile(entryCssPath, "utf8");
      return compile(css, {
        base: dirname(entryCssPath),
        onDependency: () => {},
      });
    })();
    return this.compilerPromise;
  }
}
