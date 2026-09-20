import { useEffect } from "react";
import type { RepoDiagnostic, RepoFidelity } from "../api.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";

const TONE: Record<RepoFidelity, string> = {
  exact: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  adapted: "border-primary/40 text-primary",
  unstyled: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  proxy: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  unavailable: "border-destructive/40 text-destructive",
  fallback: "border-destructive/40 text-destructive",
};

const MEANING: Record<RepoFidelity, string> = {
  exact: "Renders the app's real component.",
  adapted: "Renders through a canvas-safe adaptation.",
  unstyled: "Renders without the app's styles.",
  proxy: "A proxy snippet stands in for it.",
  unavailable: "Can't render in the canvas — a labelled fallback stands in.",
  fallback: "A fallback stands in for it.",
};

/**
 * Fidelity chip; renders nothing until the status is known — and nothing for an
 * `exact` verdict no frame has mounted yet. The build check knows only that the
 * module compiles and exports the component, so claiming "exact" before
 * anything rendered it is a promise that flips to "unavailable" on first view.
 * A problem is worth saying early; a clean bill of health is not.
 */
export function RepoFidelityChip({
  diagnostic,
  className,
}: {
  diagnostic: RepoDiagnostic | null | undefined;
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
  const key = enabled ? ids.join(",") : "";
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => void loadRepoStatus(key.split(",")), 250);
    return () => clearTimeout(timer);
  }, [key, loadRepoStatus]);
}
