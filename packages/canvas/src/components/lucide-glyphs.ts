import { pascalizeIconName } from "@velloo/schema/icon-name";
import type { LucideProps } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

type Glyph = ComponentType<LucideProps>;

/** Every lucide glyph by export name — canonical names plus lucide's aliases. */
export type LucideGlyphs = ReadonlyMap<string, Glyph>;

let glyphs: LucideGlyphs | null = null;
let pending: Promise<LucideGlyphs> | null = null;

/**
 * Keep only the glyphs. Lucide's namespace also exports its base `Icon`,
 * `createLucideIcon`, the `icons` table and a context provider — none of them
 * an icon a prop can name, and the base `Icon` throws when rendered without
 * icon data. Every glyph carries a `displayName`; those exports don't.
 */
export function glyphTable(namespace: Record<string, unknown>): LucideGlyphs {
  const table = new Map<string, Glyph>();
  for (const [name, value] of Object.entries(namespace)) {
    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { displayName?: unknown }).displayName === "string"
    ) {
      table.set(name, value as Glyph);
    }
  }
  return table;
}

/**
 * The glyph an icon prop names, resolved the way the Icon helper renders it:
 * the exact export first (PascalCase, or one of lucide's renamed-icon
 * aliases), then the kebab / snake / lowercase spellings agents also write —
 * "check", "chevron-right".
 */
export function resolveGlyph(table: LucideGlyphs | null, name: string): Glyph | undefined {
  const trimmed = name.trim();
  if (!table || trimmed === "") return undefined;
  return table.get(trimmed) ?? table.get(pascalizeIconName(trimmed));
}

/**
 * The whole icon set is over a megabyte, and only the icon-prop controls ever
 * look an icon up by name — so it is its own chunk, fetched the first time one
 * of those mounts rather than on every canvas load.
 */
function loadGlyphs(): Promise<LucideGlyphs> {
  pending ??= import("./lucide-all.ts").then((m) => {
    glyphs = glyphTable(m);
    return glyphs;
  });
  return pending;
}

/** The glyph table, or null for the moment it takes the chunk to arrive. */
export function useLucideGlyphs(): LucideGlyphs | null {
  const [loaded, setLoaded] = useState(glyphs);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadGlyphs().then((g) => {
      if (live) setLoaded(g);
    });
    return () => {
      live = false;
    };
  }, [loaded]);
  return loaded;
}
