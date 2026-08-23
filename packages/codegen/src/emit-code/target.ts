/**
 * A codegen target describes how a framework lowers a velloo node tree to
 * native code — which import a component id resolves to. Absent ⇒ the default
 * shadcn behavior (the built-in REGISTRY + `@/components/ui/*` imports).
 *
 * The target is consulted *before* the built-in shadcn REGISTRY so a MUI
 * screen's `Card` / `Box` / `Button` resolve to MUI, not the shadcn primitives
 * of the same id. Styling is unaffected here — the node's `sx` (or `style`)
 * object serializes through the generic prop path as `sx={{…}}`.
 */
export interface CodegenTarget {
  /**
   * Resolve a component id to a native bare import (`{ Card } from
   * "@mui/material"`), or null to fall through to the shadcn REGISTRY /
   * extension path.
   */
  importFor(id: string): { jsxName: string; from: string } | null;
}

/**
 * A target where every listed id imports as a named export from a single
 * module — MUI's `@mui/material`, where `Box`, `Card`, `Typography`, … all
 * come from one specifier. Ids outside the set fall through (so extensions and
 * lucide icons still resolve their own way).
 */
export function moduleTarget(ids: Iterable<string>, from: string): CodegenTarget {
  const set = new Set(ids);
  return { importFor: (id) => (set.has(id) ? { jsxName: id, from } : null) };
}
