/**
 * Accumulate (jsxName, importFile) pairs while walking the tree, then emit
 * one import statement per source file with deduplicated, sorted specifiers.
 */
export class ImportSet {
  /** importFile → Set of jsxNames imported from there. */
  private byFile = new Map<string, Set<string>>();

  add(importFile: string, jsxName: string): void {
    let bucket = this.byFile.get(importFile);
    if (!bucket) {
      bucket = new Set();
      this.byFile.set(importFile, bucket);
    }
    bucket.add(jsxName);
  }

  toCode(componentsAlias: string): string {
    const lines: string[] = [];
    const files = [...this.byFile.keys()].sort();
    for (const file of files) {
      const names = [...(this.byFile.get(file) ?? new Set<string>())].sort();
      lines.push(`import { ${names.join(", ")} } from "${componentsAlias}/${file}";`);
    }
    return lines.join("\n");
  }

  isEmpty(): boolean {
    return this.byFile.size === 0;
  }
}
