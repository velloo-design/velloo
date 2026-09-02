// Upstream shadcn's `cn`, re-pointed at velloo's configured tailwind-merge: a
// design folder's theme generates the typeset utilities (`text-h1`, …), which
// the stock config would misgroup as colors and silently drop.
export { cn } from "@velloo/helpers";
