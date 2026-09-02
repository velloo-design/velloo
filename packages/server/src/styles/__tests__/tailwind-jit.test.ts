import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createMuiProvider } from "@velloo/provider-mui";
import { TYPESET_SCALE_NAMES, typesetSafelist, typesetThemeTokens } from "@velloo/schema";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import { TailwindJit } from "../tailwind-jit.ts";

const provider = createShadcnProvider();

let tmp: string;
let jit: TailwindJit;

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-jit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(tmp, "screens"), { recursive: true });
  await mkdir(join(tmp, "snippets"), { recursive: true });
  jit = new TailwindJit(provider, join(tmp, "screens"), join(tmp, "snippets"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("TailwindJit.build", () => {
  // #7: a class that only exists in a render_snippet preview's in-memory args
  // never hits disk, so the scan can't see it. Extra candidates make it paint
  // anyway, without poisoning the shared (pure disk-scan) cache.
  test("extraCandidates compile classes the disk scan never saw", async () => {
    const base = await jit.build();
    expect(base).not.toContain("#abcdef");

    const withExtra = await jit.build(["from-[#abcdef]"]);
    expect(withExtra).toContain("#abcdef");

    // The extra must not leak into the cached base build.
    const baseAgain = await jit.build();
    expect(baseAgain).not.toContain("#abcdef");
  });

  // A pure-MUI folder has no Tailwind-channel provider; build() must short-circuit
  // to empty rather than try to compile MUI's stub entry (which can't resolve
  // `tailwindcss`). Mixed folders still compile the Tailwind providers' entries.
  test("returns empty for a non-Tailwind (MUI-only) folder without compiling", async () => {
    const muiJit = new TailwindJit(
      createMuiProvider(),
      join(tmp, "screens"),
      join(tmp, "snippets"),
    );
    expect(await muiJit.build()).toBe("");
  });

  test("still compiles when a Tailwind provider sits alongside MUI", async () => {
    const mixed = new TailwindJit(
      [createMuiProvider(), provider],
      join(tmp, "screens"),
      join(tmp, "snippets"),
    );
    const css = await mixed.build(["bg-primary"]);
    expect(css.length).toBeGreaterThan(0);
  });

  // The velloo helpers live in @velloo/helpers, outside every provider's
  // componentsDir — the structural default classes still written as literals in
  // those `.tsx` files (Placeholder's aspect/size ladders, which no screen needs
  // to reference) must land in the compiled CSS. The typography ladder no longer
  // relies on this scan; see the safelist test below.
  test("helper default classes compile from the @velloo/helpers scan", async () => {
    const css = await jit.build();
    expect(css).toContain(".aspect-square");
    expect(css).toContain(".size-8");
  });

  // The typeset ladder's class literals live in @velloo/schema — a `.ts` module
  // the oxide scanner never reads — and no screen JSON references them. The
  // generated `@source inline(...)` is what makes them compile anyway, and it is
  // the mechanism that let the ladder stop being duplicated into `heading.tsx`
  // purely so it would be scanned.
  test("the typeset ladder compiles from the safelist, not from a scan", async () => {
    const safelisted = new TailwindJit(provider, join(tmp, "screens"), join(tmp, "snippets"), () =>
      [
        ...typesetSafelist().map((p) => `@source inline("${p}");`),
        `@theme {\n${typesetThemeTokens().join("\n")}\n}`,
      ].join("\n\n"),
    );
    const css = await safelisted.build();
    for (const role of TYPESET_SCALE_NAMES) {
      expect(css).toContain(`.text-${role}`);
      expect(css).toContain(`.leading-${role}`);
      expect(css).toContain(`.tracking-${role}`);
    }
    // …and it resolves to the derived token, not a literal size.
    expect(css).toMatch(/\.text-h1\s*\{[^}]*var\(--text-h1\)/);
    // The tone classes `textClasses` composes come from the same unscanned
    // module, so they ride the safelist too.
    expect(css).toContain(".text-muted-foreground");
  });
});

describe("TailwindJit host @config (Tailwind v3 support)", () => {
  // A screen using bare `container` so the scanner emits the candidate.
  async function writeContainerScreen() {
    await writeFile(
      join(tmp, "screens", "s.json"),
      JSON.stringify({
        id: "s",
        name: "S",
        tree: { $ref: "Box", props: { className: "container" } },
      }),
    );
  }
  // All `.container` rules (brace-matched), concatenated. v4 emits the centering as a
  // *second* `.container` rule, and scanning the whole sheet for `margin-inline:auto` would
  // false-positive on the `.mx-auto` utility shadcn components use — so scope to .container.
  function containerRules(css: string): string {
    const out: string[] = [];
    const re = /\.container\s*\{/g;
    for (let m = re.exec(css); m; m = re.exec(css)) {
      let i = m.index + m[0].length;
      for (let depth = 1; i < css.length && depth > 0; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
      }
      out.push(css.slice(m.index, i));
    }
    return out.join("\n");
  }

  test("bare `container` does not center without a host config (v4 default)", async () => {
    await writeContainerScreen();
    const rules = containerRules(await jit.build());
    expect(rules).not.toBe("");
    expect(/margin-inline:\s*auto/.test(rules)).toBe(false);
  });

  test("a host v3 config centers `.container` via @config, app theme stays subordinate", async () => {
    await writeContainerScreen();
    const cfg = join(tmp, "tailwind.config.ts");
    await writeFile(
      cfg,
      `export default { theme: { container: { center: true, padding: "2rem" },
         extend: { colors: { primary: "#ff0000" } } } };`,
    );
    const withCfg = new TailwindJit(
      provider,
      join(tmp, "screens"),
      join(tmp, "snippets"),
      undefined,
      undefined,
      () => cfg,
    );
    const css = await withCfg.build();
    const rules = containerRules(css);
    expect(/margin-inline:\s*auto/.test(rules)).toBe(true); // honored the app's container
    expect(rules).toContain("2rem"); // …including its padding
    // velloo's own token wins over the host config's `primary` (no raw #ff0000 token leak).
    expect(css).not.toContain("#ff0000");
  });

  test("a broken host config is ignored, not fatal", async () => {
    await writeContainerScreen();
    const cfg = join(tmp, "tailwind.config.ts");
    await writeFile(cfg, `import x from "no-such-plugin-xyz"; export default { plugins: [x] };`);
    const withCfg = new TailwindJit(
      provider,
      join(tmp, "screens"),
      join(tmp, "snippets"),
      undefined,
      undefined,
      () => cfg,
    );
    const css = await withCfg.build(); // must not throw
    expect(css.length).toBeGreaterThan(0);
    expect(/\.container\s*\{/.test(css)).toBe(true);
  });
});
