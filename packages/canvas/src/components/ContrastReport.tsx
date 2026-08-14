import { useEffect, useState } from "react";

type Tier = "AAA" | "AA" | "AAlarge" | "Fail";

interface ContrastEntry {
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  tier: Tier;
}

interface Props {
  /**
   * Triggers a refetch when changed. Pass `themeVersion` from the store
   * so the panel updates after every preset / derive / set_token.
   */
  bumpKey: number;
}

const TIER_COLOR: Record<Tier, string> = {
  AAA: "text-emerald-600 dark:text-emerald-400",
  AA: "text-emerald-600 dark:text-emerald-400",
  AAlarge: "text-amber-600 dark:text-amber-400",
  Fail: "text-rose-600 dark:text-rose-400",
};

const TIER_LABEL: Record<Tier, string> = {
  AAA: "AAA",
  AA: "AA",
  AAlarge: "AA·lg",
  Fail: "FAIL",
};

/**
 * WCAG contrast scoring of the active theme's salient pairs. Rendered
 * inline in the theme panel after every change so designers see when a
 * preset / derive flips a slot below AA.
 */
export function ContrastReport({ bumpKey }: Props) {
  const [results, setResults] = useState<ContrastEntry[] | null>(null);

  useEffect(() => {
    // The effect body doesn't read `bumpKey`, but its purpose is to
    // refetch whenever the theme changes — bumpKey is the trigger.
    void bumpKey;
    let alive = true;
    void fetch("/api/theme/contrast")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((body: { results: ContrastEntry[] }) => {
        if (alive) setResults(body.results);
      })
      .catch(() => {
        if (alive) setResults([]);
      });
    return () => {
      alive = false;
    };
  }, [bumpKey]);

  if (!results) return null;
  if (results.length === 0) {
    return (
      <div className="text-[10px] text-[var(--color-fg-muted)]">Contrast: no parseable pairs.</div>
    );
  }
  const fails = results.filter((r) => r.tier === "Fail");
  const summary = `${results.length - fails.length}/${results.length} pass WCAG AA`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--color-fg)] font-medium">Contrast</span>
        <span
          className={
            "tabular-nums " +
            (fails.length === 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400")
          }
        >
          {summary}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {results.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1 text-[10px]"
          >
            <span className="truncate text-[var(--color-fg-muted)]">{r.label}</span>
            <span className={`shrink-0 tabular-nums ${TIER_COLOR[r.tier]}`}>
              {r.ratio.toFixed(2)}:1 {TIER_LABEL[r.tier]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
