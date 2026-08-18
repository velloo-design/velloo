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
 *   2. Bundle `cli.ts` into `dist/cli.js`, inlining every `@velloo/*` package
 *      and externalizing third-party deps (so npm resolves the platform-correct
 *      `@tailwindcss/oxide` binary, ts-morph, react, … at install time).
 *   3. Generate `dist/package.json` pinned to the exact installed versions.
 *
 * The Bun runtime is still required at run time (the server uses `Bun.serve`),
 * so the binary ships with a `#!/usr/bin/env bun` shebang.
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

const cliRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliRoot, "..", "..");
const distDir = join(cliRoot, "dist");
const canvasPkg = join(repoRoot, "packages", "canvas");
const canvasDist = join(canvasPkg, "dist");
const entry = join(cliRoot, "src", "cli.ts");

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

// playwright-core is the only optional dep — screenshots are opt-in, and we
// never want its absence to fail `npm install velloo`.
const OPTIONAL = new Set(["playwright-core"]);

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

// 3. Bundle the CLI. Inline @velloo/* source; externalize every third-party
//    package so it installs (and resolves natively) the normal npm way.
step("bundling cli.js…");
const externals = new Set<string>();
const externalizeThirdParty = {
  name: "externalize-third-party",
  setup(build: Bun.PluginBuilder) {
    build.onResolve({ filter: /.*/ }, (args: { path: string }) => {
      const s = args.path;
      if (s.startsWith(".") || s.startsWith("/") || s.startsWith("@velloo/")) return undefined;
      if (s.startsWith("node:") || s.startsWith("bun:")) return { path: s, external: true };
      const top = s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0];
      externals.add(top);
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
  plugins: [externalizeThirdParty],
  define: prodCloudUrl ? { __VELLOO_DEFAULT_CLOUD_URL__: JSON.stringify(prodCloudUrl) } : {},
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

// 4. Ship the canvas next to the binary (server-export resolves `<here>/canvas`).
step("copying canvas → dist/canvas");
cpSync(canvasDist, join(distDir, "canvas"), { recursive: true });

// 4b. Ship the agent skills next to the binary (skill.ts resolves `<here>/skills`).
step("copying skills → dist/skills");
cpSync(join(repoRoot, "skills"), join(distDir, "skills"), { recursive: true });

// 4c. Ship the on-disk runtime assets that bundled @velloo/* packages read
//     relative to their source — the Tailwind entry CSS + component sources the
//     JIT scans, the snapshot manifest, and codegen's biome config. Each
//     package's path module resolves `<dist>/pkgs/<name>` when bundled.
step("copying package assets → dist/pkgs");
const PKG_ASSETS: { pkg: string; paths: string[] }[] = [
  { pkg: "shadcn-snapshot", paths: ["src", join("dist", "manifest.json")] },
  { pkg: "provider-none", paths: ["src"] },
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

// 5. Generate the publishable manifest, pinned to exact installed versions.
step("writing dist/package.json");
const dependencies: Record<string, string> = {};
const optionalDependencies: Record<string, string> = {};
for (const pkg of [...externals].sort()) {
  const target = OPTIONAL.has(pkg) ? optionalDependencies : dependencies;
  target[pkg] = installedVersion(pkg);
}

const manifest = {
  name: "velloo",
  version: VERSION,
  type: "module",
  description: "Velloo — code-shaped design canvas for solo devs",
  bin: { velloo: "./cli.js" },
  engines: { bun: ">=1.3.0" },
  files: ["cli.js", "canvas", "skills", "pkgs"],
  dependencies,
  ...(Object.keys(optionalDependencies).length ? { optionalDependencies } : {}),
};
writeFileSync(join(distDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// 6. Pack a tarball at the repo root for handoff.
step("packing tarball…");
run(["bun", "pm", "pack", "--destination", repoRoot], distDir);

const tgz = `velloo-${VERSION}.tgz`;
const bundleKb = Math.round(Bun.file(cliJs).size / 1024);
const canvasFiles = readdirSync(join(distDir, "canvas")).length;
console.log(
  [
    "",
    `\x1b[32m✓ built velloo ${VERSION}\x1b[0m`,
    `  bundle:   dist/cli.js (${bundleKb} KB)`,
    `  canvas:   dist/canvas/ (${canvasFiles} top-level entries)`,
    `  deps:     ${Object.keys(dependencies).length} runtime` +
      (Object.keys(optionalDependencies).length
        ? `, ${Object.keys(optionalDependencies).length} optional`
        : ""),
    `  tarball:  ${tgz}`,
    "",
    `  install:  bun install -g ./${tgz}   (needs Bun ≥ 1.3.0)`,
    "",
  ].join("\n"),
);
