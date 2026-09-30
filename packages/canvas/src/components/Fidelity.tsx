import { useCallback, useEffect } from "react";
import type { ComponentDiagnostic, ComponentFidelity } from "../api.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";

const TONE: Record<ComponentFidelity, string> = {
  exact: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  adapted: "border-primary/40 text-primary",
  "server-rendered": "border-primary/40 text-primary",
  unstyled: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  proxy: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  unchecked: "border-muted-foreground/40 text-muted-foreground",
  unavailable: "border-destructive/40 text-destructive",
  fallback: "border-destructive/40 text-destructive",
};

const MEANING: Record<ComponentFidelity, string> = {
  exact: "Renders the app's real component.",
  adapted: "Renders through a canvas-safe adaptation.",
  "server-rendered": "Rendered on the server, not mounted in the browser.",
  unstyled: "Renders without the app's styles.",
  proxy: "A proxy snippet stands in for it.",
  unchecked: "How this renders has not been established.",
  unavailable: "Can't render in the canvas — a labelled fallback stands in.",
  fallback: "A fallback stands in for it.",
};

/**
 * Fidelity chip; renders nothing until the status is known — and nothing for an
 * `exact` verdict no frame has mounted yet. The build check knows only that the
 * module compiles and exports the component, so claiming "exact" before
 * anything rendered it is a promise that flips to "unavailable" on first view.
 * A problem is worth saying early; a clean bill of health is not.
 *
 * `server-rendered` is shown unconditionally: it needs no frame to establish,
 * and without it a component the canvas never mounts would look like one that
 * renders the real library.
 */
export function FidelityChip({
  diagnostic,
  className,
}: {
  diagnostic: ComponentDiagnostic | null | undefined;
  className?: string;
}) {
  if (!diagnostic) return null;
  const status = diagnostic.status;
  if (status === "exact" && !diagnostic.observed) return null;
  const tone = TONE[status] ?? "text-muted-foreground";
  const meaning = MEANING[status] ?? status;
  return (
    <Badge
      variant="outline"
      data-fidelity={status}
      className={`px-1.5 py-0 text-[10px] font-normal ${tone} ${className ?? ""}`}
      title={diagnostic.note ? `${meaning} ${diagnostic.note}` : meaning}
    >
      {status}
    </Badge>
  );
}

/**
 * Ask the daemon for these ids' fidelity. Debounced so a search narrowing the
 * visible rows keystroke by keystroke asks once it settles — each ask builds a
 * browser bundle.
 */
export function useRepoStatus(ids: string[], enabled = true): void {
  const loadRepoStatus = useCanvas((s) => s.loadRepoStatus);
  useDebouncedStatus(ids, enabled, loadRepoStatus);
}

/** The same, for one library's own components. */
export function useLibraryStatus(library: string, ids: string[], enabled = true): void {
  const loadLibraryStatus = useCanvas((s) => s.loadLibraryStatus);
  const load = useCallback(
    (wanted: string[]) => loadLibraryStatus(library, wanted),
    [loadLibraryStatus, library],
  );
  useDebouncedStatus(ids, enabled, load);
}

function useDebouncedStatus(
  ids: string[],
  enabled: boolean,
  load: (ids: string[]) => Promise<void>,
): void {
  const key = enabled ? ids.join(",") : "";
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => void load(key.split(",")), 250);
    return () => clearTimeout(timer);
  }, [key, load]);
}
