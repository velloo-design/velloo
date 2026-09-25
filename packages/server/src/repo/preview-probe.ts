import type { RepoCatalog, RepoCatalogEntry } from "./catalog.ts";

type PreviewState = "absent" | "valid" | "failing";

/**
 * What a probe mount says about the preview entry. A component that rendered
 * cleanly proves it; one that threw while mounted without props its call site
 * passed as code (`items={navItems}`) proves nothing — that is a verdict on
 * the props, and calling the entry failing sends the agent to fix providers
 * that are fine. Such a probe is inconclusive and leaves the state as it was.
 */
export function probeVerdict(opts: {
  prior: PreviewState;
  mounted: boolean;
  ownStatus: string | undefined;
  ownCode: string | undefined;
  wrapperError: boolean;
  dropped: readonly string[];
}): { state: PreviewState; inconclusive: boolean } {
  const healthy =
    opts.mounted &&
    opts.ownStatus !== undefined &&
    ["exact", "adapted"].includes(opts.ownStatus) &&
    !opts.wrapperError;
  if (healthy) return { state: "valid", inconclusive: false };
  const inconclusive =
    !opts.wrapperError && opts.ownCode === "render-threw" && opts.dropped.length > 0;
  if (inconclusive) return { state: opts.prior, inconclusive: true };
  // Components that render fine with no wrapper need no preview entry.
  if (opts.prior === "absent" && !opts.wrapperError)
    return { state: "absent", inconclusive: false };
  return { state: "failing", inconclusive: false };
}

/**
 * The component a preview probe mounts. A root the app renders with a
 * recorded call site gives it realistic props; one a recipe speaks for is
 * preferred, since that is what the entry wraps. A call site that passed code
 * is recorded without it, so a complete one beats one that dropped props.
 */
export function pickProbe(
  catalog: RepoCatalog,
  app: string | undefined,
  component: string | undefined,
): RepoCatalogEntry | undefined {
  const candidates = catalog.entries.filter((entry) => (entry.identity.app ?? undefined) === app);
  if (component) return candidates.find((entry) => entry.id === component);
  const complete = (entry: RepoCatalogEntry) => !entry.states[0]?.dropped?.length;
  const roots = candidates.filter((entry) => !entry.identity.member);
  return (
    roots.find((entry) => entry.recipe && entry.states.length > 0 && complete(entry)) ??
    roots.find((entry) => entry.states.length > 0 && complete(entry)) ??
    roots.find((entry) => entry.recipe && entry.states.length > 0) ??
    roots.find((entry) => entry.states.length > 0) ??
    roots[0]
  );
}
