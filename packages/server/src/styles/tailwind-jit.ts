import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import type { ComponentProvider } from "@velloo/provider";

type Compiler = Awaited<ReturnType<typeof compile>>;

/**
 * Tailwind v4 compiled on-demand against the active providers' component
 * sources + the user's live pages folder. Replaces the static safelisted
 * CSS the snapshot used to ship: anything the user (or an agent) writes
 * as a className is generated.
 *
 * Sprint Y: takes an array of providers (one per registered library).
 * Each provider contributes its `componentsDir` to the scan and its
 * `styleEntryPath` to the entry-CSS merge. Single-library folders pass
 * an array of one — no special-case path.
 *
 * The expensive step is `compile()` (parse entry CSS, resolve @theme,
 * register @custom-variant rules). We do that once at server start and
 * reuse the returned `build(candidates)` function on every fetch.
 *
 * The scan + build is cached and invalidated on any page/theme change so
 * a burst of MCP edits doesn't pay the cost N times.
 */
export class TailwindJit {
  private compilerPromise: Promise<Compiler> | null = null;
  private cached: string | null = null;
  private readonly snippetsDir: string;
  private readonly providers: ComponentProvider[];

  constructor(
    providers: ComponentProvider[] | ComponentProvider,
    private readonly pagesDir: string,
    snippetsDir?: string,
    /**
     * Extra entry CSS appended after the providers' (e.g. an @theme
     * block with the folder theme's --font-<role> tokens so
     * `font-display` style utilities compile). Re-read on every
     * invalidate, so theme edits take effect without a restart.
     */
    private readonly extraEntryCss?: () => string,
  ) {
    this.providers = Array.isArray(providers) ? providers : [providers];
    if (this.providers.length === 0) {
      throw new Error("TailwindJit: at least one provider is required.");
    }
    this.snippetsDir = snippetsDir ?? join(pagesDir, "..", "snippets");
  }

  /**
   * Drop the cached CSS so the next build() rescans the page + snippet
   * folders. Also drops the compiler: the entry CSS embeds theme font
   * tokens, and a stale compiler would never learn a new font role.
   */
  invalidate(): void {
    this.cached = null;
    this.compilerPromise = null;
  }

  async build(): Promise<string> {
    if (this.cached !== null) return this.cached;
    const compiler = await this.getCompiler();
    const dedupedDirs = Array.from(new Set(this.providers.map((p) => p.componentsDir)));
    const scanner = new Scanner({
      sources: [
        ...dedupedDirs.map((base) => ({ base, pattern: "**/*.tsx", negated: false })),
        { base: this.pagesDir, pattern: "**/*.json", negated: false },
        { base: this.snippetsDir, pattern: "**/*.json", negated: false },
      ],
    });
    const candidates = scanner.scan();
    this.cached = compiler.build(candidates);
    return this.cached;
  }

  /**
   * Merge each provider's entry CSS into one Tailwind input. Today every
   * shipping provider uses the same `@theme` token names; the merge is
   * effectively a `cat`. When a future provider ships divergent tokens
   * (e.g. MUI mapping to a different palette shape) we'll need real
   * conflict detection — left as a TODO with a soft-warn for now.
   */
  private async mergedEntryCss(): Promise<{ css: string; base: string }> {
    const primary = this.providers[0];
    if (!primary) {
      throw new Error("TailwindJit: providers is empty, cannot build entry CSS.");
    }
    const primaryBase = dirname(primary.styleEntryPath);
    const extra = this.extraEntryCss?.() ?? "";
    if (this.providers.length === 1) {
      const css = await readFile(primary.styleEntryPath, "utf8");
      return { css: extra ? `${css}\n\n${extra}` : css, base: primaryBase };
    }
    const sources = await Promise.all(
      this.providers.map(async (p) => {
        const css = await readFile(p.styleEntryPath, "utf8");
        return `/* === provider: ${p.id} (${p.version}) === */\n${css}`;
      }),
    );
    const merged = sources.join("\n\n");
    return { css: extra ? `${merged}\n\n${extra}` : merged, base: primaryBase };
  }

  private getCompiler(): Promise<Compiler> {
    if (this.compilerPromise) return this.compilerPromise;
    this.compilerPromise = (async () => {
      const { css, base } = await this.mergedEntryCss();
      return compile(css, {
        base,
        onDependency: () => {},
      });
    })();
    return this.compilerPromise;
  }
}
