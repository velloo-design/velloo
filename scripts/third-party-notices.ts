#!/usr/bin/env bun
/**
 * Generates and checks `THIRD-PARTY-NOTICES.md`.
 *
 *   bun run notices:build   # rewrite the file from the dependency graph
 *   bun run notices:check   # CI: fail on drift or on a license we can't ship
 *
 * The package list comes from the bundler, not from package.json: the CLI and
 * the canvas are bundled in memory with `metafile: true` (the same entries,
 * externals and targets `packages/cli/build.ts` and the canvas Vite build use),
 * and every `node_modules` input that lands in either bundle is a package the
 * published tarball redistributes. A declared-dependency walk would list what
 * tree-shaking drops and miss what a dependency drags in.
 *
 * The few packages the bundle leaves external are npm-installed next to it, and
 * the direct-install archives ship that `node_modules` verbatim — so their full
 * production closure is listed too. Optional platform binaries are listed from
 * their parent's manifest rather than read from disk: only the host platform's
 * copy is installed, and the file must come out the same on every machine.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cssImportedPackagesIn } from "../packages/cli/src/css-imports.ts";
import { BUN_VERSION, RUNTIME_TARGETS } from "./distribution/targets.ts";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outFile = join(repoRoot, "THIRD-PARTY-NOTICES.md");

/** Mirrors `EXTERNAL` in packages/cli/build.ts; the check below catches drift. */
const EXTERNAL = ["tailwindcss", "@tailwindcss/node", "@tailwindcss/oxide", "playwright-core"];

/** The source trees build.ts copies into `dist/pkgs`, whose CSS `@import`s packages. */
const SHIPPED_CSS_DIRS = [
  "helpers/src",
  "schema/src",
  "shadcn-snapshot/src",
  "provider-none/src",
  "provider-mui/src",
  "provider-antd/src",
  "provider-chakra/src",
].map((dir) => join(repoRoot, "packages", dir));

/**
 * Licenses that impose nothing beyond keeping the notice (and, for MPL-2.0,
 * pointing at the unmodified upstream source). Anything else fails the check
 * until someone has read it.
 */
const ACCEPTED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "Zlib",
]);

type Distribution = "bundled" | "installed";

interface Entry {
  name: string;
  version: string;
  license: string;
  copyright: string;
  source: string;
  distribution: Set<Distribution>;
  notice?: string | undefined;
  note?: string;
}

// ── package.json access ─────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed)) throw new Error(`${file} is not a JSON object`);
  return parsed;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) if (typeof v === "string") out[key] = v;
  return out;
}

function licenseOf(pkg: Json): string {
  const single = pkg.license;
  if (typeof single === "string") return single.trim();
  if (isRecord(single)) return str(single.type) ?? "";
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((l: unknown) => (typeof l === "string" ? l : isRecord(l) ? str(l.type) : undefined))
      .filter((l): l is string => l !== undefined);
    return types.length > 1 ? `(${types.join(" OR ")})` : (types[0] ?? "");
  }
  return "";
}

function sourceOf(pkg: Json, name: string): string {
  const repo = pkg.repository;
  let url = typeof repo === "string" ? repo : isRecord(repo) ? str(repo.url) : undefined;
  const directory = isRecord(repo) ? str(repo.directory) : undefined;
  if (url !== undefined) {
    if (/^github:/.test(url)) url = url.slice("github:".length);
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    url = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@/, "https://")
      .replace(/^git@([^:]+):/, "https://$1/")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "");
    if (directory !== undefined && /github\.com/.test(url) && !url.includes("/tree/")) {
      url = `${url}/tree/HEAD/${directory.replace(/^\.?\//, "")}`;
    }
    return url;
  }
  return str(pkg.homepage) ?? `https://www.npmjs.com/package/${name}`;
}

const COPYRIGHT =
  /(?:\bcopyright\s*(?:\(c\)|©)?\s+(?!notice|holder|owner|law|doctrine|and\b|\[|\{|<|statement|license)|(?:\(c\)|©)\s*(?=\d{4}))(.+)/i;

/** Copyright holders named in a text, as `© …` lines in file order. */
function copyrightLines(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").split(/\r?\n/)) {
    const holder = COPYRIGHT.exec(raw)?.[1]
      ?.replace(/<[^>]*>/g, "")
      .replace(/[<>]/g, "")
      .replace(/^(\(c\)|©)\s*/i, "")
      .replace(/\s*all rights reserved\.?/i, "")
      .replace(/\s+/g, " ")
      .replace(/[\s.,;]+$/, "");
    if (holder === undefined || holder === "" || found.includes(`© ${holder}`)) continue;
    found.push(`© ${holder}`);
  }
  return found;
}

const LICENSE_FILE = /^(licen[cs]e|copying)([.-]|$)/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The package's copyright lines — from its license and NOTICE files and any
 * `licenses/` directory of embedded third-party code, else its readme, else
 * its author.
 */
function copyrightOf(dir: string, pkg: Json): string {
  const names = readdirSync(dir).sort();
  const embedded = join(dir, "licenses");
  const primary = [
    ...names.filter((f) => LICENSE_FILE.test(f) || NOTICE_FILE.test(f)).map((f) => join(dir, f)),
    ...(existsSync(embedded) ? readdirSync(embedded).sort() : []).map((f) => join(embedded, f)),
  ];
  const readmes = names.filter((f) => /^readme([.-]|$)/i.test(f)).map((f) => join(dir, f));
  for (const files of [primary, readmes]) {
    const lines = [...new Set(files.flatMap((file) => copyrightLines(readText(file) ?? "")))].slice(
      0,
      4,
    );
    if (lines.length > 0) return lines.join("; ");
  }
  const author = pkg.author;
  const name = typeof author === "string" ? author : isRecord(author) ? str(author.name) : "";
  const cleaned = (name ?? "").replace(/\s*[<(].*$/, "").trim();
  return cleaned === "" ? "—" : `© ${cleaned}`;
}

/** A NOTICE file the package ships, which Apache-2.0 §4(d) requires passing on. */
function noticeOf(dir: string): string | undefined {
  const file = readdirSync(dir)
    .sort()
    .find((f) => NOTICE_FILE.test(f));
  return file === undefined ? undefined : readText(join(dir, file))?.trim();
}

// ── the redistributed set ───────────────────────────────────────────────────

const entries = new Map<string, Entry>();

function add(dir: string, distribution: Distribution): Json {
  const pkg = readJson(join(dir, "package.json"));
  const name = str(pkg.name);
  const version = str(pkg.version);
  if (name === undefined || version === undefined) {
    throw new Error(`${dir}/package.json has no name or version`);
  }
  const key = `${name}@${version}`;
  const existing = entries.get(key);
  if (existing) {
    existing.distribution.add(distribution);
    return pkg;
  }
  entries.set(key, {
    name,
    version,
    license: licenseOf(pkg),
    copyright: copyrightOf(dir, pkg),
    source: sourceOf(pkg, name),
    distribution: new Set([distribution]),
    notice: noticeOf(dir),
  });
  return pkg;
}

/** The package root owning a bundled input (metafile paths are cwd-relative). */
function packageDirOf(input: string): string | undefined {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (match?.[1] === undefined) return undefined;
  return resolve(process.cwd(), match[1]);
}

interface Bundle {
  meta: Bun.BuildMetafile;
  /** Bare specifiers the emitted JavaScript still imports at runtime. */
  runtimeImports: Set<string>;
}

async function bundle(label: string, config: Parameters<typeof Bun.build>[0]): Promise<Bundle> {
  const result = await Bun.build({ ...config, metafile: true, throw: false });
  if (!result.success || result.metafile === undefined) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundling the ${label} for its metafile failed`);
  }
  // The metafile's own `external` flag also marks re-exports tree-shaking
  // dropped, so read what the output actually imports instead.
  const scanner = new Bun.Transpiler({ loader: "js" });
  const runtimeImports = new Set<string>();
  for (const output of result.outputs) {
    if (!output.path.endsWith(".js")) continue;
    for (const imp of scanner.scanImports((await output.text()).replace(/^#!.*/, ""))) {
      if (!imp.path.startsWith(".") && !imp.path.startsWith("/")) runtimeImports.add(imp.path);
    }
  }
  return { meta: result.metafile, runtimeImports };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const externalFilter = new RegExp(`^(${EXTERNAL.map(escapeRe).join("|")})(/|$)`);
const topLevel = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);

const cli = await bundle("CLI", {
  entrypoints: [join(repoRoot, "packages", "cli", "src", "cli.ts")],
  target: "bun",
  format: "esm",
  splitting: true,
  plugins: [
    {
      name: "externalize-runtime-deps",
      setup(build) {
        build.onResolve({ filter: externalFilter }, (args) => ({
          path: args.path,
          external: true,
        }));
      },
    },
  ],
});
const canvas = await bundle("canvas", {
  entrypoints: [join(repoRoot, "packages", "canvas", "src", "main.tsx")],
  target: "browser",
  format: "esm",
  splitting: true,
  plugins: [
    {
      // Vite serves `public/` from the root; those files are listed by hand.
      name: "public-dir",
      setup(build) {
        build.onResolve({ filter: /^\/fonts\// }, (args) => ({ path: args.path, external: true }));
      },
    },
  ],
});

const unexpected = new Set<string>();
for (const { meta, runtimeImports } of [cli, canvas]) {
  const contributing = new Set<string>();
  for (const output of Object.values(meta.outputs)) {
    for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
      if (bytesInOutput > 0) contributing.add(input);
    }
  }
  for (const input of [...contributing].sort()) {
    const dir = packageDirOf(input);
    if (dir === undefined) continue;
    if (!existsSync(join(dir, "package.json"))) {
      throw new Error(`bundled input ${input} has no package.json at ${dir}`);
    }
    add(dir, "bundled");
  }
  for (const spec of runtimeImports) {
    if (/^(node|bun):/.test(spec) || spec === "bun" || isBuiltin(spec)) continue;
    if (!EXTERNAL.includes(topLevel(spec))) unexpected.add(spec);
  }
}
if (unexpected.size > 0) {
  throw new Error(
    `the bundle imports packages at runtime that this script doesn't list: ${[...unexpected].sort().join(", ")} — sync EXTERNAL with packages/cli/build.ts`,
  );
}

// ── npm-installed runtime dependencies and their closure ────────────────────

const workspaceDirs = readdirSync(join(repoRoot, "packages")).map((d) =>
  join(repoRoot, "packages", d),
);

/** Node's walk-up lookup, reading directories rather than `exports` maps. */
function findPackage(name: string, from: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const installedRoots = new Set([...EXTERNAL, ...SHIPPED_CSS_DIRS.flatMap(cssDeps)]);
function cssDeps(dir: string): string[] {
  return existsSync(dir) ? [...cssImportedPackagesIn(dir)] : [];
}

const visited = new Set<string>();
function addInstalled(name: string, from: string[]): void {
  let dir: string | undefined;
  for (const start of from) {
    dir = findPackage(name, start);
    if (dir !== undefined) break;
  }
  if (dir === undefined) throw new Error(`runtime dependency "${name}" is not installed`);
  const real = realpathSync(dir);
  if (visited.has(real)) return;
  visited.add(real);
  const pkg = add(real, "installed");
  const self = entries.get(`${str(pkg.name)}@${str(pkg.version)}`);
  for (const dep of Object.keys(stringMap(pkg.dependencies)).sort()) {
    addInstalled(dep, [real]);
  }
  for (const [dep, version] of Object.entries(stringMap(pkg.optionalDependencies)).sort()) {
    if (self === undefined) continue;
    const key = `${dep}@${version}`;
    if (entries.has(key)) continue;
    entries.set(key, {
      name: dep,
      version,
      license: self.license,
      copyright: self.copyright,
      source: self.source,
      distribution: new Set(["installed"]),
      note: `platform binary of \`${self.name}\``,
    });
  }
}

for (const name of [...installedRoots].sort()) addInstalled(name, workspaceDirs);

// ── license review ──────────────────────────────────────────────────────────

/** An SPDX expression is shippable when every AND term has an accepted OR branch. */
function accepted(license: string): boolean {
  const expression = license.replace(/[()]/g, "").trim();
  if (expression === "") return false;
  return expression
    .split(/\s+AND\s+/)
    .every((term) => term.split(/\s+OR\s+/).some((id) => ACCEPTED.has(id.trim())));
}

const sorted = [...entries.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const problems = sorted
  .filter((e) => !accepted(e.license))
  .map((e) => `${e.name}@${e.version}: ${e.license === "" ? "no license declared" : e.license}`);

// ── rendering ───────────────────────────────────────────────────────────────

const cell = (text: string): string => text.replace(/[\\|]/g, "\\$&").replace(/\s+/g, " ");

const PREAMBLE = `# Third-Party Notices

<!-- Generated by scripts/third-party-notices.ts — run \`bun run notices:build\`; do not edit by hand. -->

Velloo bundles and/or redistributes the third-party open-source software
listed below. Each component is the property of its respective copyright
holders and is used under the terms of its own license.

The most directly redistributed surfaces are:

- \`packages/shadcn-snapshot\` — a pinned snapshot of shadcn/ui components,
  embedded in the binary as the server-render and canvas fallback for
  components a project doesn't provide.
- The framework providers (\`@velloo/provider-*\`) and adapters, which build on
  the upstream component libraries below.
- The published CLI bundle (\`dist/cli.js\` + \`dist/chunk-*.js\` + the canvas SPA),
  which inlines its pure-JS runtime dependencies rather than installing them
  from npm.
- The few runtime dependencies the bundle can't inline (the Tailwind CSS
  compiler and its native binaries, and \`playwright-core\`), which npm installs
  beside it and the direct-install archives ship unmodified.
- Bun ${BUN_VERSION}, installed from exact official \`@oven/bun-*\` platform packages for
  npm users and copied unmodified into the standalone direct-install archives.
  Its complete upstream linked-library notice ships as \`BUN-LICENSE.md\`.

## Components outside the npm dependency graph

| Component | License | Copyright | Source |
|---|---|---|---|
| Poppins Bold (\`packages/canvas/public/fonts/poppins-700.woff2\`) | SIL Open Font License 1.1 (full text alongside the font) | © 2020 The Poppins Project Authors | https://github.com/itfoundry/Poppins |
| Bun ${BUN_VERSION} runtime and embedded libraries (${RUNTIME_TARGETS.map((t) => `\`${t.packageName}\``).join(", ")}) | MIT; LGPL-2.0 and additional terms detailed in \`BUN-LICENSE.md\` | Bun and upstream library contributors | https://github.com/oven-sh/bun/tree/bun-v${BUN_VERSION} |
| shadcn/ui component sources (vendored into \`packages/shadcn-snapshot/src\` and the canvas UI) | MIT | © 2023 shadcn | https://github.com/shadcn-ui/ui |
| Lucide icon data (the glyphs and icon names reached through \`lucide-react\`) | ISC | © Lucide Contributors (portions from Feather, MIT, © 2013–present Cole Bemis) | https://github.com/lucide-icons/lucide |
| Google Fonts catalog (\`packages/schema/src/fonts.ts\`: family names, categories and axis ranges generated from https://fonts.google.com/metadata/fonts) | Factual metadata; no font files are redistributed — the fonts load at runtime from Google Fonts under their own licenses (mostly SIL OFL 1.1 or Apache-2.0) | Font metadata © Google LLC; fonts © their respective designers | https://github.com/google/fonts |
| Elsewhere sample images (\`packages/cli/src/scaffold/elsewhere/assets\`) | Generated for this repository; no third-party source or attribution requirement (see \`ASSET-SOURCES.md\` beside them) | — | — |
`;

function packageSection(): string {
  const groups = new Map<string, Entry[]>();
  for (const entry of sorted) {
    const key = entry.license === "" ? "UNKNOWN" : entry.license;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const licenses = [...groups.keys()].sort(
    (a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || a.localeCompare(b),
  );
  const out = [
    "## npm packages",
    "",
    `${sorted.length} packages, read from the bundler's metafile for the CLI and the canvas.`,
    "**bundled** means inlined into `cli.js`, a `chunk-*.js` or the canvas SPA;",
    "**installed** means an npm-installed runtime dependency of the published",
    "package (or one of its own dependencies), shipped as-is in the direct-install",
    "archives.",
    "",
    ...licenses.map((l) => `- ${l}: ${groups.get(l)?.length ?? 0}`),
  ];
  for (const license of licenses) {
    out.push("", `### ${license}`, "", "| Package | Version | Distribution | Copyright | Source |");
    out.push("|---|---|---|---|---|");
    for (const e of groups.get(license) ?? []) {
      const how = [...e.distribution].sort().join(", ");
      const name = e.note === undefined ? `\`${e.name}\`` : `\`${e.name}\` (${e.note})`;
      out.push(`| ${name} | ${e.version} | ${how} | ${cell(e.copyright)} | ${e.source} |`);
    }
  }
  return out.join("\n");
}

function noticeSection(): string {
  const withNotice = sorted.filter((e) => e.notice !== undefined && e.notice !== "");
  if (withNotice.length === 0) return "";
  const out = [
    "## NOTICE files",
    "",
    "Reproduced from the packages that ship one, as their licenses require.",
  ];
  for (const e of withNotice) {
    out.push("", `### ${e.name} ${e.version}`, "", "```", e.notice ?? "", "```");
  }
  return out.join("\n");
}

const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ISC_WARRANTY = `THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`;

const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

${ISC_WARRANTY}`;

const ZERO_BSD_TEXT = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

${ISC_WARRANTY}`;

const BSD_3_TEXT = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

/** How each license's terms are carried: its full text, or where to find it. */
const LICENSE_TEXTS: Record<string, (names: string[]) => string> = {
  MIT: () => fence(MIT_TEXT),
  ISC: () => fence(ISC_TEXT),
  "BSD-3-Clause": () => fence(BSD_3_TEXT),
  "0BSD": () => fence(ZERO_BSD_TEXT),
  "Apache-2.0": (names) =>
    wrap(
      `Applies to ${names.join(", ")}. The full text is the same as this package's own \`LICENSE\` file (Apache License, Version 2.0, January 2004, http://www.apache.org/licenses/LICENSE-2.0); any NOTICE file they ship is reproduced above.`,
    ),
  "MPL-2.0": (names) =>
    wrap(
      `Applies to ${names.join(", ")}, which are installed unmodified from npm; their Source Code Form is available from the repository listed for each. The full text is at https://mozilla.org/MPL/2.0/.`,
    ),
};

function fence(text: string): string {
  return `\`\`\`\n${text}\n\`\`\``;
}

function wrap(text: string, width = 80): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines.join("\n");
}

function licenseTextSection(): string {
  const ids = new Map<string, Set<string>>();
  for (const e of sorted) {
    for (const id of e.license.replace(/[()]/g, "").split(/\s+(?:AND|OR)\s+/)) {
      const key = id.trim();
      if (key === "") continue;
      if (!ids.has(key)) ids.set(key, new Set());
      ids.get(key)?.add(`\`${e.name}\``);
    }
  }
  const order = ["MIT", "ISC", "BSD-3-Clause", "0BSD", "Apache-2.0", "MPL-2.0"];
  const present = [...ids.keys()].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b),
  );
  const out = [
    "## License texts",
    "",
    wrap(
      "Poppins is distributed under the SIL Open Font License 1.1; its copyright notice and full license text ship beside the font as `packages/canvas/public/fonts/OFL-1.1.txt` and are copied into release artifacts with the canvas. The complete Bun upstream notice and relinking information is provided in `BUN-LICENSE.md`. The npm packages above are distributed under the licenses whose texts follow; the copyright lines of each apply as listed in its table row. (The Apache-2.0 text also ships as this package's own LICENSE file.)",
    ),
  ];
  for (const id of present) {
    const render = LICENSE_TEXTS[id];
    const names = [...(ids.get(id) ?? [])].sort((a, b) =>
      a.replace(/`/g, "").localeCompare(b.replace(/`/g, "")),
    );
    out.push("", `### ${id}`, "");
    out.push(
      render === undefined
        ? wrap(
            `Applies to ${names.join(", ")}. The full text is at https://spdx.org/licenses/${id}.html.`,
          )
        : render(names),
    );
  }
  return out.join("\n");
}

const rendered = `${[PREAMBLE.trimEnd(), packageSection(), noticeSection(), licenseTextSection()]
  .filter((part) => part !== "")
  .join("\n\n")}\n`;

// ── output ──────────────────────────────────────────────────────────────────

const check = process.argv.includes("--check");
for (const problem of problems) console.warn(`warning: unreviewed license — ${problem}`);

if (check) {
  const current = readText(outFile);
  let failed = problems.length > 0;
  if (current !== rendered) {
    console.error("THIRD-PARTY-NOTICES.md is out of date — run `bun run notices:build`.");
    failed = true;
  }
  if (failed) process.exit(1);
  console.log(`THIRD-PARTY-NOTICES.md is current (${sorted.length} packages).`);
} else {
  writeFileSync(outFile, rendered);
  console.log(`wrote THIRD-PARTY-NOTICES.md (${sorted.length} packages)`);
}
