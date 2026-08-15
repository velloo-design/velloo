/**
 * Canvas-safe adapter layer for shadcn components. The upstream
 * provider (`@velloo/provider-shadcn-upstream`) fetches vanilla shadcn
 * sources at a pinned version and consults this package to decide which
 * components need a canvas-mode replacement and which can pass through
 * unchanged. See `docs/decisions.md` #25.
 *
 * Consumers typically import:
 *
 *   - `ADAPTATION_MAP` / `strategyFor(id)` — the policy table.
 *   - `./components/<id>.tsx` — the actual replacement modules. The
 *     bundler resolves these through the package's `exports`. Each
 *     module's exported names match the upstream shadcn surface
 *     (`Dialog`, `DialogContent`, `DialogTrigger`, …) so a replace is
 *     drop-in.
 */
export {
  ADAPTATION_MAP,
  type AdaptationStrategy,
  replacementIds,
  strategyFor,
} from "./adaptation-map.ts";
export {
  type CanvasInline,
  inlineOpenAttrs,
  pinOpenInDesignMode,
} from "./lib/canvas-portal.tsx";
export { cn } from "./lib/utils.ts";
