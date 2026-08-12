/**
 * Accumulate (jsxName, source) pairs while walking the tree, then emit one
 * import statement per source. There are two flavors of source:
 *   - shadcn: a kebab module under the configured components alias
 *     (e.g. "button" → `@/components/ui/button`).
 *   - bare: a literal package name used verbatim
 *     (e.g. "lucide-react" → `lucide-react`).
 */

type Source = { kind: "shadcn"; file: string } | { kind: "bare"; specifier: string };

function keyOf(s: Source): string {
  return s.kind === "shadcn" ? `shadcn:${s.file}` : `bare:${s.specifier}`;
}

export class ImportSet {
  /** key → (source, set of jsxNames imported from there). */
  private buckets = new Map<string, { source: Source; names: Set<string> }>();

  /** Add a shadcn-style import (resolved later via componentsAlias). */
  add(importFile: string, jsxName: string): void {
    this.addSource({ kind: "shadcn", file: importFile }, jsxName);
  }

  /** Add a bare-specifier import — passed through verbatim. */
  addBare(specifier: string, jsxName: string): void {
    this.addSource({ kind: "bare", specifier }, jsxName);
  }

  private addSource(source: Source, jsxName: string): void {
    const key = keyOf(source);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { source, names: new Set() };
      this.buckets.set(key, bucket);
    }
    bucket.names.add(jsxName);
  }

  toCode(componentsAlias: string): string {
    const sortedKeys = [...this.buckets.keys()].sort();
    const lines: string[] = [];
    for (const key of sortedKeys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      const names = [...bucket.names].sort();
      const from =
        bucket.source.kind === "shadcn"
          ? `${componentsAlias}/${bucket.source.file}`
          : bucket.source.specifier;
      lines.push(`import { ${names.join(", ")} } from "${from}";`);
    }
    return lines.join("\n");
  }

  isEmpty(): boolean {
    return this.buckets.size === 0;
  }
}
