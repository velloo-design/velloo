#!/usr/bin/env bun
/**
 * Build a self-contained, publishable `velloo` package.
 *
 * The monorepo can't be installed as-is: the CLI is `private`, its `@velloo/*`
 * deps are `workspace:*`, and the canvas is an un-built Vite artifact. This
 * script collapses all of that into one directory you can `bun pm pack` and
 * hand off (or `npm publish` later):
 *
 *   1. Build the canvas SPA and drop it next to the binary (`dist/canvas`).
 *   2. Bundle `cli.ts` into `dist/cli.js` + lazy chunks (`dist/chunk-*.js`,
 *      flat next to cli.js — see the naming note at the Bun.build call),
 *      inlining `@velloo/*` AND every pure-JS third-party dep. Only packages
 *      that must resolve from disk at install time stay external: the
 *      Tailwind family (native `@tailwindcss/oxide` binary + the CSS assets
 *      the JIT reads) and `playwright-core`. Framework providers
 *      (antd/MUI/chakra/shadcn-snapshot) are dynamic imports in
 *      `packages/server/src/providers.ts`, so `splitting` turns each into a
 *      chunk that only loads for folders targeting that framework.
 *   3. Generate `dist/package.json` pinned to the exact installed versions
 *      of the few remaining external deps.
 *
 * The published package is launched by Node, which selects the matching
 * optional official `@oven/bun-*` package and invokes its private Bun binary.
 * These packages contain the executable directly and run no install scripts.
 * End users therefore need Node/npm for installation, but never a global Bun.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUN_VERSION, RUNTIME_TARGETS } from "../../scripts/distribution/targets.ts";

const cliRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliRoot, "..", "..");
const distDir = join(cliRoot, "dist");
const canvasPkg = join(repoRoot, "packages", "canvas");
const canvasDist = join(canvasPkg, "dist");
const entry = join(cliRoot, "src", "cli.ts");
const launcher = join(cliRoot, "launcher.cjs");

const cliPkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
const VERSION: string = cliPkg.version;

/**
 * Versions declared across the workspace manifests — the fallback for
 * packages the resolver can't introspect (e.g. `@modelcontextprotocol/sdk`
 * is subpath-only with no `"."` export). Canvas is scanned last and never
 * overrides, so a server-side dep wins over the SPA's copy on conflict
 * (e.g. lucide-react), matching what the CLI bundle actually links.
 */
function declaredVersions(): Map<string, string> {
  const map = new Map<string, string>();
  const pkgsDir = join(repoRoot, "packages");
  const manifests = [
    join(repoRoot, "package.json"),
    ...readdirSync(pkgsDir)
      .filter((d) => d !== "canvas")
      .map((d) => join(pkgsDir, d, "package.json")),
    join(pkgsDir, "canvas", "package.json"),
  ];
  for (const m of manifests) {
    if (!existsSync(m)) continue;
    const json = JSON.parse(readFileSync(m, "utf8"));
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, range] of Object.entries(json[field] ?? {})) {
        if (typeof range === "string" && !range.startsWith("workspace:") && !map.has(name)) {
          map.set(name, range);
        }
      }
    }
  }
  return map;
}
const DECLARED = declaredVersions();

// The only packages that stay npm-installed. Everything else — react, zod,
// hono, the MCP SDK, antd, MUI, chakra, echarts, radix, … — is inlined into
// the bundle, which is what keeps `npm install velloo` at a handful of deps
// instead of ~330MB of framework trees. Stay external here only when a
// package can't be inlined:
//   - @tailwindcss/oxide is a per-platform native binary npm must resolve.
//   - @tailwindcss/node loads that binary and resolves `tailwindcss`'s
//     on-disk CSS assets, which the JIT also reads at runtime.
//   - playwright-core locates browsers/assets from its own package directory;
//     the large Chromium download remains opt-in via `velloo browser install`.
const EXTERNAL = new Set([
  "tailwindcss",
  "@tailwindcss/node",
  "@tailwindcss/oxide",
  "playwright-core",
]);

function step(msg: string): void {
  console.log(`\x1b[36m▸\x1b[0m ${msg}`);
}

function run(cmd: string[], cwd: string): void {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (!proc.success) throw new Error(`\`${cmd.join(" ")}\` failed (exit ${proc.exitCode})`);
}

/** Exact installed version of a package, via Bun's resolver (handles the
 *  hoisted `.bun` store and `exports` maps). */
function installedVersion(pkg: string): string {
  for (const from of [cliRoot, repoRoot]) {
    // Fast path: most packages export `./package.json`.
    try {
      const v = JSON.parse(
        readFileSync(Bun.resolveSync(`${pkg}/package.json`, from), "utf8"),
      ).version;
      if (typeof v === "string") return v;
    } catch {}
    // Fallback for packages that hide package.json behind `exports`: resolve
    // the entry, then walk up to the owning manifest.
    try {
      let dir = dirname(Bun.resolveSync(pkg, from));
      for (let i = 0; i < 12; i++) {
        const pj = join(dir, "package.json");
        if (existsSync(pj)) {
          const j = JSON.parse(readFileSync(pj, "utf8"));
          if (j.name === pkg && typeof j.version === "string") return j.version;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {}
  }
  const declared = DECLARED.get(pkg);
  if (declared) return declared;
  throw new Error(`cannot resolve installed version of "${pkg}" — is it installed?`);
}

/**
 * The build stamp baked into the binary's `--version` (see src/version.ts):
 * `<version> (<short-sha>[-dirty] · <build-date>)`. Derived from git at build
 * time so a dogfooder's `--version` maps to an exact commit; degrades to just
 * `<version> (<build-date>)` if git is unavailable (e.g. building off a tarball).
 */
function buildVersion(): string {
  const git = (args: string[]): string | undefined => {
    const p = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
    return p.success ? p.stdout.toString().trim() : undefined;
  };
  const sha = git(["rev-parse", "--short", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  const dirty = status !== undefined && status !== "";
  const now = new Date();
  const pad = (n: number): string => `${n}`.padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const ref = sha ? `${sha}${dirty ? "-dirty" : ""} · ${date}` : date;
  return `${VERSION} (${ref})`;
}
const BUILD_VERSION = buildVersion();

// 1. Clean.
step("cleaning dist/");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. Build the canvas SPA.
step("building canvas SPA (vite)…");
run(["bun", "run", "build"], canvasPkg);
if (!existsSync(join(canvasDist, "index.html"))) {
  throw new Error("canvas build produced no index.html");
}

// 3. Bundle the CLI. Inline @velloo/* source and pure-JS third-party deps;
//    only the EXTERNAL allowlist installs the normal npm way.
//
//    The plugin's filter is scoped to exactly the EXTERNAL packages — do NOT
//    widen it to a catch-all that returns `undefined` for everything else.
//    A matched-but-undefined onResolve breaks Bun's importer-relative
//    resolution under the isolated linker, and `target: "bun"` then silently
//    keeps the unresolvable bare specifier as a runtime import — the build
//    "succeeds" while antd/MUI/react are quietly missing from the bundle
//    (see the stray-import tripwire after the build).
step("bundling cli.js…");
const externals = new Set<string>();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const EXTERNAL_FILTER = new RegExp(`^(${[...EXTERNAL].map(escapeRe).join("|")})(/|$)`);
const externalizeRuntimeDeps = {
  name: "externalize-runtime-deps",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: EXTERNAL_FILTER }, (args: { path: string }) => {
      const s = args.path;
      const top = s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0];
      if (top) externals.add(top);
      return { path: s, external: true };
    });
  },
};

// `cli:prod` sets VELLOO_BUILD_CLOUD_URL so the installed binary defaults to the
// hosted cloud (see src/cloud.ts). Unset → the binary defaults to localhost.
const prodCloudUrl = process.env.VELLOO_BUILD_CLOUD_URL;
if (prodCloudUrl) step(`baking default cloud URL → ${prodCloudUrl}`);

const result = await Bun.build({
  entrypoints: [entry],
  outdir: distDir,
  target: "bun",
  format: "esm",
  // Each dynamic import (the framework providers) becomes a lazy chunk; a
  // shadcn user never parses antd/MUI/chakra. Whitespace+syntax minification
  // keeps the inlined-framework bundle a sane size; identifiers stay readable
  // so user-facing stack traces still mean something.
  //
  // Chunks MUST land flat in dist/, next to cli.js — every inlined module
  // that resolves shipped assets does so relative to import.meta.url
  // (`<here>/canvas` for the SPA, `<here>/pkgs/<name>` for provider sources,
  // `<here>/skills`, `<here>/plugins`), and after splitting, `here` is the
  // CHUNK's directory. A chunks/ subfolder broke all of those in the
  // installed binary ("Velloo canvas not built"). Guarded below.
  splitting: true,
  naming: { chunk: "chunk-[hash].[ext]" },
  minify: { whitespace: true, syntax: true, identifiers: false },
  plugins: [externalizeRuntimeDeps],
  define: {
    __VELLOO_BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
    ...(prodCloudUrl ? { __VELLOO_DEFAULT_CLOUD_URL__: JSON.stringify(prodCloudUrl) } : {}),
  },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("bundle failed");
}

const cliJs = join(distDir, "cli.js");
if (!existsSync(cliJs)) throw new Error(`expected ${cliJs} — Bun.build emitted something else`);
// Bun preserves the entry's shebang; normalize to exactly one valid line-1 shebang.
const code = readFileSync(cliJs, "utf8").replace(/^(#!.*\r?\n)+/, "");
writeFileSync(cliJs, `#!/usr/bin/env bun\n${code}`);
chmodSync(cliJs, 0o755);

// Tripwire for the silent-corruption mode described above: a heavy package
// that should have been inlined surviving as a REAL bare import means the
// bundler left it to runtime resolution, where it can never resolve. Minified
// code renders true imports as `from"antd"` / `import"antd"` (unescaped,
// no space); the same names inside prose/codegen-template strings are quoted
// *escaped*, so they don't match.
step("verifying no stray bare imports…");
const MUST_BE_INLINED = [
  "antd",
  "@mui/material",
  "@chakra-ui/react",
  "echarts",
  "react",
  "zod",
  "hono",
  "@modelcontextprotocol/sdk",
];
const chunkNames = readdirSync(distDir).filter((f) => /^chunk-.*\.js$/.test(f));
// Flat-layout guard (see the naming comment above): a chunk in a subdirectory
// shifts import.meta.url and breaks every `<here>/…` asset resolution.
const strayDirs = readdirSync(distDir, { withFileTypes: true }).filter(
  (e) => e.isDirectory() && e.name !== "canvas",
);
if (strayDirs.length > 0) {
  throw new Error(
    `bundle emitted subdirectories (${strayDirs.map((e) => e.name).join(", ")}) — chunks must sit flat next to cli.js so import.meta.url asset resolution keeps working`,
  );
}
const bundleFiles = [cliJs, ...chunkNames.map((f) => join(distDir, f))];
for (const file of bundleFiles) {
  const src = readFileSync(file, "utf8");
  for (const pkg of MUST_BE_INLINED) {
    if (src.includes(`from"${pkg}"`) || src.includes(`import"${pkg}"`)) {
      throw new Error(
        `stray bare import of "${pkg}" in ${file} — the bundler externalized a package that must be inlined (broken plugin resolution?)`,
      );
    }
  }
}

// 4. Ship the canvas next to the binary (server-export resolves `<here>/canvas`).
step("copying canvas → dist/canvas");
cpSync(canvasDist, join(distDir, "canvas"), { recursive: true });

// 4b. Ship the agent skills next to the binary (skill.ts resolves `<here>/skills`).
step("copying skills → dist/skills");
cpSync(join(repoRoot, "skills"), join(distDir, "skills"), { recursive: true });

// 4b². Ship the plugin assets — the Claude Code plugin + Gemini extension
//      sources (plugin.ts resolves `<here>/plugins`).
step("copying plugins → dist/plugins");
cpSync(join(repoRoot, "plugins"), join(distDir, "plugins"), { recursive: true });

// 4c. Ship the on-disk runtime assets that bundled @velloo/* packages read
//     relative to their source — the Tailwind entry CSS + component sources the
//     JIT scans, the snapshot manifest, and codegen's biome config. Each
//     package's path module resolves `<dist>/pkgs/<name>` when bundled.
step("copying package assets → dist/pkgs");
// The snapshot manifest is a build product, not checked in — a fresh clone or
// worktree hasn't generated it yet. Build it on demand (same treatment as the
// canvas SPA above) instead of failing the install with "missing asset".
const snapshotPkg = join(repoRoot, "packages", "shadcn-snapshot");
if (!existsSync(join(snapshotPkg, "dist", "manifest.json"))) {
  step("building shadcn-snapshot manifest…");
  run(["bun", "run", "build"], snapshotPkg);
}
const PKG_ASSETS: { pkg: string; paths: string[] }[] = [
  { pkg: "helpers", paths: ["src"] },
  { pkg: "shadcn-snapshot", paths: ["src", join("dist", "manifest.json")] },
  { pkg: "provider-none", paths: ["src"] },
  { pkg: "provider-mui", paths: ["src"] },
  { pkg: "provider-antd", paths: ["src"] },
  { pkg: "provider-chakra", paths: ["src"] },
  { pkg: "codegen", paths: ["biome.codegen.json"] },
];
// Don't ship test files — they'd be discovered by `bun test` from the copy
// and run from the wrong location (and they aren't runtime assets).
const notATest = (src: string): boolean =>
  !/(^|[/\\])__tests__([/\\]|$)/.test(src) && !/\.test\.[cm]?[jt]sx?$/.test(src);
for (const { pkg, paths } of PKG_ASSETS) {
  for (const rel of paths) {
    const from = join(repoRoot, "packages", pkg, rel);
    if (!existsSync(from)) throw new Error(`missing package asset: ${from}`);
    cpSync(from, join(distDir, "pkgs", pkg, rel), { recursive: true, filter: notATest });
  }
}

// 4d. Ship the docs npm renders/expects: README (the npmjs page), LICENSE +
//     NOTICE (Apache-2.0), the bundled third-party license texts, and the exact
//     Bun 1.4 linked-library notice. README/LICENSE/NOTICE are auto-included by
//     pack; the two third-party files ride the files whitelist.
step("copying docs → dist/");
for (const doc of ["README.md", "LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.md", "BUN-LICENSE.md"]) {
  cpSync(join(repoRoot, doc), join(distDir, doc));
}

// 5. Generate the publishable manifest, pinned to exact installed versions.
step("writing dist/package.json");
// Nothing imports the `tailwindcss` package directly (it would land in
// `externals` if it did) — but the JIT resolves `@import "tailwindcss"` from
// the shipped entry-CSS assets under dist/pkgs, and only a DIRECT dependency
// is guaranteed to sit where that walk-up finds it (a transitive install of
// @tailwindcss/node's copy may be nested under non-hoisting installers).
externals.add("tailwindcss");

const dependencies: Record<string, string> = {};
const optionalDependencies: Record<string, string> = Object.fromEntries(
  RUNTIME_TARGETS.map((target) => [target.packageName, BUN_VERSION]),
);
for (const pkg of [...externals].sort()) {
  dependencies[pkg] = installedVersion(pkg);
}

const manifest = {
  name: "velloo",
  version: VERSION,
  type: "module",
  description:
    "Local-first, code-shaped design canvas — your AI agent designs with your real components, in your repo",
  license: "Apache-2.0",
  homepage: "https://github.com/velloo-design/velloo#readme",
  repository: { type: "git", url: "git+https://github.com/velloo-design/velloo.git" },
  bugs: { url: "https://github.com/velloo-design/velloo/issues" },
  keywords: [
    "design",
    "design-tool",
    "canvas",
    "mcp",
    "ai-agent",
    "claude-code",
    "shadcn",
    "tailwind",
    "mui",
    "local-first",
    "bun",
  ],
  bin: { velloo: "./launcher.cjs" },
  engines: { node: ">=18" },
  files: [
    "cli.js",
    "launcher.cjs",
    "chunk-*.js",
    "canvas",
    "skills",
    "plugins",
    "pkgs",
    "NOTICE",
    "THIRD-PARTY-NOTICES.md",
    "BUN-LICENSE.md",
  ],
  dependencies,
  ...(Object.keys(optionalDependencies).length ? { optionalDependencies } : {}),
};
writeFileSync(join(distDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(launcher, join(distDir, "launcher.cjs"));
chmodSync(join(distDir, "launcher.cjs"), 0o755);

// 6. Pack a tarball at the repo root for handoff.
step("packing tarball…");
run(["bun", "pm", "pack", "--destination", repoRoot], distDir);

const tgz = `velloo-${VERSION}.tgz`;
const bundleKb = Math.round(Bun.file(cliJs).size / 1024);
const chunksKb = Math.round(
  chunkNames.reduce((sum, f) => sum + Bun.file(join(distDir, f)).size, 0) / 1024,
);
const canvasFiles = readdirSync(join(distDir, "canvas")).length;
console.log(
  [
    "",
    `\x1b[32m✓ built velloo ${BUILD_VERSION}\x1b[0m`,
    `  bundle:   dist/cli.js (${bundleKb} KB) + ${chunkNames.length} lazy chunks (${chunksKb} KB)`,
    `  canvas:   dist/canvas/ (${canvasFiles} top-level entries)`,
    `  deps:     ${Object.keys(dependencies).length} runtime` +
      (Object.keys(optionalDependencies).length
        ? `, ${Object.keys(optionalDependencies).length} optional`
        : ""),
    `  tarball:  ${tgz}`,
    "",
    `  install:  npm install -g ./${tgz}   (private Bun ${process.versions.bun})`,
    "",
  ].join("\n"),
);
