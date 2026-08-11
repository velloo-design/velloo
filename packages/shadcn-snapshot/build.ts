#!/usr/bin/env bun
/**
 * Builds packages/shadcn-snapshot/dist/{styles.css, manifest.json}.
 *
 * Run via `bun run build` from this package.
 *
 * Components are vendored manually following the patterns at
 * https://ui.shadcn.com/docs/components — each component file carries a
 * provenance comment. The shadcn snapshotVersion is recorded in package.json's
 * `snapshotVersion` field; bump it when re-syncing from upstream.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type PropertySignature, SyntaxKind } from "ts-morph";
import type { ComponentDescriptor, ControlType, Manifest, PropDescriptor } from "./src/manifest.ts";
import { registry } from "./src/registry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");
const componentsDir = join(here, "src", "components");

async function buildCss(): Promise<void> {
  const entry = join(here, "src", "tailwind-entry.css");
  const out = join(distDir, "styles.css");
  await mkdir(distDir, { recursive: true });

  const proc = Bun.spawn(["bun", "x", "@tailwindcss/cli", "-i", entry, "-o", out, "--minify"], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: here,
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`tailwindcss build failed (exit ${code})`);
  }
  console.log(`✓ wrote ${out}`);
}

function categorize(filePath: string): {
  source: "shadcn" | "velloo";
  category: "ui" | "typography";
} {
  const rel = filePath.startsWith(componentsDir)
    ? filePath.slice(componentsDir.length).replace(/^\/+/, "")
    : filePath;
  if (rel.startsWith("velloo/")) return { source: "velloo", category: "typography" };
  return { source: "shadcn", category: "ui" };
}

const COLOR_NAME = /^(color|background|fg|bg|theme|fill|stroke|tint|accent)/i;

/**
 * Infer the inspector control type from a TS type string. Heuristic; keep it
 * conservative — wrong inferences produce ugly inputs, not data corruption.
 */
function inferControl(
  name: string,
  rawType: string,
): { control: ControlType; enumValues?: (string | number)[] } {
  const type = rawType.replace(/\s+/g, " ").trim();
  // Strip the trailing | undefined (and leading "undefined |").
  const stripped = type
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s !== "undefined" && s !== "null")
    .join(" | ");

  if (stripped === "boolean") return { control: "boolean" };
  if (stripped === "number") return { control: "number" };

  // Numeric literal union: "1 | 2 | 3".
  const numLit = stripped.split("|").map((s) => s.trim());
  if (numLit.length > 1 && numLit.every((s) => /^-?\d+(\.\d+)?$/.test(s))) {
    return { control: "enum", enumValues: numLit.map(Number) };
  }

  // String literal union: '"a" | "b" | "c"'.
  if (
    numLit.length > 1 &&
    numLit.every(
      (s) => (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")),
    )
  ) {
    return { control: "enum", enumValues: numLit.map((s) => s.slice(1, -1)) };
  }

  if (stripped === "string") {
    if (COLOR_NAME.test(name)) return { control: "color" };
    return { control: "string" };
  }

  // Fallback: treat anything else as a string field (e.g. union with ReactNode).
  return { control: "string" };
}

function describeProp(prop: PropertySignature): PropDescriptor {
  const name = prop.getName();
  const type = prop.getType().getText(prop).replace(/\s+/g, " ");
  const inferred = inferControl(name, type);
  return {
    name,
    type,
    optional: prop.hasQuestionToken(),
    control: inferred.control,
    ...(inferred.enumValues ? { enumValues: inferred.enumValues } : {}),
  };
}

async function buildManifest(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: join(here, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(`${componentsDir}/**/*.tsx`);

  const components: ComponentDescriptor[] = [];

  for (const id of Object.keys(registry).sort()) {
    const srcFile = project.getSourceFiles().find((f) => {
      const text = f.getFullText();
      return text.includes(`export const ${id}`) || text.includes(`export function ${id}`);
    });
    if (!srcFile) {
      console.warn(`! manifest: no source file found for ${id}, skipping`);
      continue;
    }

    const { source, category } = categorize(srcFile.getFilePath());
    const propsInterface = srcFile.getInterface(`${id}Props`);
    let props: PropDescriptor[] = [];
    if (propsInterface) {
      props = propsInterface.getProperties().map(describeProp);
    } else {
      const propsAlias = srcFile.getTypeAlias(`${id}Props`);
      if (propsAlias) {
        const literal = propsAlias.getDescendantsOfKind(SyntaxKind.TypeLiteral)[0];
        if (literal) {
          props = literal.getProperties().map(describeProp);
        }
      }
    }

    components.push({ id, category, source, props });
  }

  await mkdir(distDir, { recursive: true });
  const out = join(distDir, "manifest.json");
  await writeFile(out, `${JSON.stringify(components satisfies Manifest, null, 2)}\n`, "utf8");
  console.log(`✓ wrote ${out} (${components.length} components)`);
}

await buildCss();
await buildManifest();
