import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { helpersComponentsDir } from "@velloo/helpers/paths";
import { type ComponentProvider, type CssFramework, styleChannelOf } from "@velloo/provider";

type Compiler = Awaited<ReturnType<typeof compile>>;

/**
 * Tailwind v4 compiled on-demand against the active providers' component
 * sources + the user's live pages folder. Replaces the static safelisted
 * CSS the snapshot used to ship: anything the user (or an agent) writes
 * as a className is generated.
 *
 * Takes an array of providers (one per registered library).
 * Each provider contributes its `componentsDir` to the scan and its
 * `styleEntryPath` to the entry-CSS merge. Single-library folders pass
 * an array of one — no special-case path. Tailwind itself stays
 * embedded while scan sources move with the active providers.
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
  private cachedCandidates: string[] | null = null;
  private readonly snippetsDir: string;
  private readonly providers: ComponentProvider[];
  /**
   * The subset whose style channel actually compiles Tailwind (shadcn / no-lib).
   * MUI (`needsTailwindJit: false`) is excluded — its `styleEntryPath` is a
   * contract stub, not a real Tailwind entry, so feeding it to the compiler
   * would fail to resolve `tailwindcss`. A pure-MUI folder has none, so
   * `build()` short-circuits to empty.
   */
  private readonly tailwindProviders: ComponentProvider[];

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
    /**
     * Extra source dirs to scan for classes — the live-island host
     * component dirs, so utilities used inside a `render:"live"` component
     * compile. Re-read on every build (after invalidate), so registering a
     * live extension brings its classes in without a restart.
     */
    private readonly extraSourceDirs?: () => string[],
    /**
     * Absolute path to the host app's legacy Tailwind config (or null). When present
     * it's injected as a v4 `@config` directive so the app's container/screens/plugins
     * apply in the canvas; velloo's `@theme` tokens stay authoritative. Compiled with a
     * fallback — a config that throws (missing plugin, etc.) is dropped, not fatal.
     */
    private readonly hostConfigPath?: () => string | null,
    /**
     * The folder's CSS framework — resolves each provider's active channel, so
     * a `none/none` folder (the no-lib provider on the inline-`style` channel)
     * drops out of the Tailwind set and `build()` short-circuits to empty.
     */
    folderCss?: CssFramework,
  ) {
    this.providers = Array.isArray(providers) ? providers : [providers];
    if (this.providers.length === 0) {
      throw new Error("TailwindJit: at least one provider is required.");
    }
    this.tailwindProviders = this.providers.filter(
      (p) => styleChannelOf(p, folderCss).needsTailwindJit,
    );
    this.snippetsDir = snippetsDir ?? join(pagesDir, "..", "snippets");
  }

  /**
   * Drop the cached CSS so the next build() rescans the page + snippet
   * folders. Also drops the compiler: the entry CSS embeds theme font
   * tokens, and a stale compiler would never learn a new font role.
   */
  invalidate(): void {
    this.cached = null;
    this.cachedCandidates = null;
    this.compilerPromise = null;
  }

  /**
   * Compile the folder's CSS. `extraCandidates` are class names not present in
   * any scanned file — notably a `render_snippet` preview's instance args /
   * `extraClassName`, which live only in the in-memory synthesized screen, so
   * the disk scan can't see them (and an arbitrary value like
   * `from-[hsl(…)]` would silently not paint). They compile fresh and are not
   * cached, so the shared cache stays the pure disk-scan result.
   */
  async build(extraCandidates?: string[]): Promise<string> {
    // No Tailwind-channel provider (e.g. a pure-MUI folder) ⇒ no CSS to compile.
    if (this.tailwindProviders.length === 0) return "";
    const hasExtra = extraCandidates !== undefined && extraCandidates.length > 0;
    if (!hasExtra && this.cached !== null) return this.cached;
    const compiler = await this.getCompiler();
    const candidates = this.scanCandidates();
    if (!hasExtra) {
      this.cached = compiler.build(candidates);
      return this.cached;
    }
    return compiler.build([...candidates, ...extraCandidates]);
  }

  /** Scan the providers' components + the page/snippet JSON for class candidates. */
  private scanCandidates(): string[] {
    if (this.cachedCandidates !== null) return this.cachedCandidates;
    // The framework-neutral velloo helpers live outside every provider's
    // `componentsDir` (in @velloo/helpers) but ship in every Tailwind-channel
    // registry, so their structural default classes (Heading's size ladder,
    // Placeholder's aspect classes, …) must always be scanned.
    const dedupedDirs = Array.from(
      new Set([...this.tailwindProviders.map((p) => p.componentsDir), helpersComponentsDir]),
    );
    const hostDirs = Array.from(new Set(this.extraSourceDirs?.() ?? []));
    const scanner = new Scanner({
      sources: [
        ...dedupedDirs.map((base) => ({ base, pattern: "**/*.tsx", negated: false })),
        ...hostDirs.map((base) => ({ base, pattern: "**/*.tsx", negated: false })),
        { base: this.pagesDir, pattern: "**/*.json", negated: false },
        { base: this.snippetsDir, pattern: "**/*.json", negated: false },
      ],
    });
    this.cachedCandidates = scanner.scan();
    return this.cachedCandidates;
  }

  /**
   * The merged Tailwind entry CSS (every provider's entry + the theme's
   * `@theme` block) plus the base dir for `@import` resolution. Exposed so
   * automatic diagnostics can parse a design system from the *same* input the
   * build compiles against — otherwise theme-injected utilities
   * (`bg-ink`, `font-display`) read as invalid. Re-read fresh, so it tracks
   * `set_token` / `set_fonts` edits.
   */
  entryCss(): Promise<{ css: string; base: string }> {
    return this.mergedEntryCss();
  }

  /**
   * Merge each provider's entry CSS into one Tailwind input. Today every
   * shipping provider uses the same `@theme` token names, so the merge is
   * effectively a `cat` (each block gets a provider-id comment header for
   * traceability). When a future provider ships divergent tokens (e.g. MUI
   * mapping to a different palette shape) we'll need real conflict detection
   * — deferred until then; concatenation is last-wins for now.
   */
  private async mergedEntryCss(): Promise<{ css: string; base: string }> {
    // Only Tailwind-channel providers contribute a real entry; MUI's stub is skipped.
    const primary = this.tailwindProviders[0];
    if (!primary) {
      throw new Error("TailwindJit: no Tailwind-channel provider, cannot build entry CSS.");
    }
    const primaryBase = dirname(primary.styleEntryPath);
    const extra = this.extraEntryCss?.() ?? "";
    if (this.tailwindProviders.length === 1) {
      const css = await readFile(primary.styleEntryPath, "utf8");
      return { css: extra ? `${css}\n\n${extra}` : css, base: primaryBase };
    }
    const sources = await Promise.all(
      this.tailwindProviders.map(async (p) => {
        const css = await readFile(p.styleEntryPath, "utf8");
        return `/* === provider: ${p.id} (${p.version}) === */\n${css}`;
      }),
    );
    const merged = sources.join("\n\n");
    return { css: extra ? `${merged}\n\n${extra}` : merged, base: primaryBase };
  }

  private warnedHostConfig = false;

  private getCompiler(): Promise<Compiler> {
    if (this.compilerPromise) return this.compilerPromise;
    this.compilerPromise = (async () => {
      const { css, base } = await this.mergedEntryCss();
      const hostConfig = this.hostConfigPath?.() ?? null;
      if (hostConfig) {
        // `@config` is appended after the provider entry so velloo's `@theme` (CSS, parsed
        // first) wins for tokens it owns; the host config supplies container/screens/plugins.
        const withConfig = `${css}\n@config ${JSON.stringify(hostConfig)};\n`;
        try {
          return await compile(withConfig, { base, onDependency: () => {} });
        } catch (err) {
          // A broken/unresolvable host config must never break the canvas — drop it.
          if (!this.warnedHostConfig) {
            this.warnedHostConfig = true;
            console.error(
              `velloo: ignoring host Tailwind config ${hostConfig} — it failed to compile ` +
                `(${err instanceof Error ? err.message.split("\n")[0] : String(err)}). ` +
                "Container/screens from it won't apply in the canvas.",
            );
          }
        }
      }
      return compile(css, { base, onDependency: () => {} });
    })();
    return this.compilerPromise;
  }
}
