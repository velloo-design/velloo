/**
 * Sprint A: this layer is dormant. The page+variant geometry it depended on
 * is gone; the Board layout no longer exposes variant.position so the
 * connector math needs to be re-derived against frames.
 *
 * Sprint D rewires this against board frames (and uses screen-shared linkage
 * so an annotation on a node lights up across every frame that shows that
 * screen). Until then, annotations are read-only data on the store but not
 * rendered.
 */
export function AnnotationsLayer(): null {
  return null;
}
