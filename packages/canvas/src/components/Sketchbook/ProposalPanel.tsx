import type { ContrastPair, ProposalCheck } from "@velloo/protocol";
import type { SketchbookProposal } from "@velloo/schema";
import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { proposalSpecimenSrc, sketchbook as sketchbookApi } from "../../api/sketchbook.ts";
import { useCanvas } from "../../store.ts";
import { SpecimenFrame } from "../DesignLanguage/SpecimenPreview.tsx";
import { Badge } from "../ui/badge.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

/** Under AA for body text: what the agent is asked to fix and the person should know about. */
const failing = (p: ContrastPair) => p.tier === "Fail" || p.tier === "AAlarge";

/**
 * A direction's proposed tokens on the design's own components: the specimen
 * drawn with the proposal over the theme on screen (in memory, nothing
 * written), and its colour pairs scored as `score_theme_contrast` scores a
 * theme, the ones under AA flagged.
 */
export function ProposalPanel({
  sketchbookId,
  direction,
  proposal,
  version,
}: {
  sketchbookId: string;
  direction: string;
  proposal: SketchbookProposal;
  /** When the sketchbook last changed: a new proposal re-renders and re-scores. */
  version: string;
}) {
  const themeName = useCanvas((s) => s.themeName);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  const [check, setCheck] = useState<ProposalCheck | null>(null);
  const rev = `${version}.${themeVersion}`;

  // `rev` is what changes when the proposal or the theme beneath it does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scored on every new version
  useEffect(() => {
    let live = true;
    void sketchbookApi
      .proposal(sketchbookId, direction, themeName)
      .then((c) => live && setCheck(c))
      .catch(
        (err: unknown) =>
          live &&
          setCheck({ contrast: [], problem: err instanceof Error ? err.message : String(err) }),
      );
    return () => {
      live = false;
    };
  }, [sketchbookId, direction, themeName, rev]);

  const pairs = check?.contrast.filter((p) => p.mode === scheme) ?? [];
  const under = check?.contrast.filter(failing) ?? [];
  const faces = proposal.fonts.map((f) => `${f.family} (${f.role})`);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-proposal={direction}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Specimen with these tokens</span>
        {under.length > 0 ? (
          <Badge variant="destructive">
            {under.length} {under.length === 1 ? "pair" : "pairs"} under AA
          </Badge>
        ) : check && !check.problem ? (
          <Badge variant="secondary">Every pair passes AA</Badge>
        ) : null}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="ml-auto"
          value={scheme}
          onValueChange={(v) => (v === "light" || v === "dark" ? setScheme(v) : null)}
        >
          <ToggleGroupItem value="light" className="text-xs">
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="text-xs">
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {check?.problem ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {check.problem}
        </p>
      ) : (
        <div className="flex h-[460px]">
          <SpecimenFrame
            key={scheme}
            scheme={scheme}
            src={proposalSpecimenSrc(sketchbookId, direction, themeName, scheme, rev)}
            rev={themeVersion}
          />
        </div>
      )}
      {faces.length > 0 ? (
        <p className="text-xs text-muted-foreground">Type: {faces.join(", ")}</p>
      ) : null}
      {pairs.length > 0 ? (
        <ul
          aria-label={`Contrast, ${scheme}`}
          className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2"
        >
          {pairs.map((p) => (
            <li
              key={p.label}
              data-tier={p.tier}
              className={`flex items-center gap-2 ${failing(p) ? "text-destructive" : ""}`}
            >
              <span className="flex shrink-0">
                <span
                  className="size-3 rounded-sm ring-1 ring-border"
                  style={{ background: p.bg }}
                />
                <span
                  className="-ml-1 size-3 rounded-sm ring-1 ring-border"
                  style={{ background: p.fg }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="tabular-nums">{p.ratio.toFixed(2)}:1</span>
              <span className="w-12 text-right font-medium">
                {p.tier === "AAlarge" ? "AA large" : p.tier}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
