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
import type { ComponentDescriptor, Manifest, PropDescriptor } from "./src/manifest.ts";
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

function describeProp(prop: PropertySignature): PropDescriptor {
  return {
    name: prop.getName(),
    type: prop.getType().getText(prop).replace(/\s+/g, " "),
    optional: prop.hasQuestionToken(),
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
    // Locate the source file declaring this id.
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
      // Direct props on the interface (skip inherited HTMLAttributes / VariantProps for brevity).
      props = propsInterface.getProperties().map(describeProp);
    } else {
      // Heuristic: scan VariableDeclarations for a typed prop alias.
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
