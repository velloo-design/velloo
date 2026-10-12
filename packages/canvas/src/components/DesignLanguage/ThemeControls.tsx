import type { Theme } from "@velloo/schema";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useCanvas } from "../../store.ts";
import { ContrastReport } from "../ContrastReport.tsx";
import { SeedPalette } from "../ThemeColors.tsx";
import { FontsSection } from "../typography/FontsSection.tsx";
import { TypographySection } from "../typography/TypographySection.tsx";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { FieldLegend, FieldSet } from "../ui/field.tsx";
import { RolesEditor } from "./RolesEditor.tsx";
import { StartingPoints } from "./StartingPoints.tsx";

/**
 * The controls a theme is edited with — one set, used in two places. The
 * design-language stage points them at the default theme beside a specimen;
 * the Theme rail points them at whichever theme the board on screen renders
 * with. They write to `themeName` from the store, so neither place has to say
 * which theme that is.
 */

/** How many of the theme's text pairs fail contrast — the one thing worth flagging from afar. */
export function useContrastFailures(): number {
  const themeName = useCanvas((s) => s.themeName);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    void themeVersion;
    let alive = true;
    const q = themeName === "default" ? "" : `?name=${encodeURIComponent(themeName)}`;
    void fetch(`/api/theme/contrast${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((body: { results: Array<{ tier: string }> }) => {
        if (alive) setFailures(body.results.filter((r) => r.tier === "Fail").length);
      })
      .catch(() => {
        if (alive) setFailures(0);
      });
    return () => {
      alive = false;
    };
  }, [themeName, themeVersion]);
  return failures;
}

interface ColourProps {
  theme: Theme;
  /**
   * Where to start from leads. That is the first decision of a new language
   * and beside the point once there is one, so anywhere else it waits below
   * the roles, closed, for starting over.
   */
  startFirst?: boolean;
  /** The palette being edited, and the switch that changes it. */
  scheme: "light" | "dark";
  onSchemeChange: (scheme: "light" | "dark") => void;
}

export function ColourControls({ theme, startFirst = false, scheme, onSchemeChange }: ColourProps) {
  const themeVersion = useCanvas((s) => s.themeVersion);
  const failures = useContrastFailures();
  return (
    <div className="flex flex-col gap-5">
      {startFirst ? (
        <>
          <FieldSet>
            <FieldLegend variant="label">Start from a direction</FieldLegend>
            <StartingPoints />
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Or from one colour</FieldLegend>
            <SeedPalette />
          </FieldSet>
        </>
      ) : null}
      <FieldSet>
        <FieldLegend variant="label">Roles</FieldLegend>
        <RolesEditor theme={theme} scheme={scheme} onSchemeChange={onSchemeChange} />
      </FieldSet>
      {startFirst ? null : (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-full justify-start">
              Start over from a direction or a colour
              <ChevronDown className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-4 pt-2">
            <StartingPoints />
            <SeedPalette />
          </CollapsibleContent>
        </Collapsible>
      )}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group w-full justify-start">
            Contrast
            <span
              className={
                failures > 0 ? "text-xs text-destructive" : "text-xs text-muted-foreground"
              }
            >
              {failures > 0 ? `${failures} failing` : "all pairs pass"}
            </span>
            <ChevronDown className="ml-auto transition-transform group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <ContrastReport bumpKey={themeVersion} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface TypeProps {
  theme: Theme;
  /** Opens the font browser for a role; the caller swaps its pane for it. */
  onBrowse: (role: string) => void;
  /**
   * Edit the baseline rhythm only. True where the subject is the language as
   * a whole; the named presets are a tool for one prose region at a time.
   */
  baselineOnly?: boolean;
}

export function TypeControls({ theme, onBrowse, baselineOnly = false }: TypeProps) {
  return (
    <div className="flex flex-col gap-5">
      <FieldSet>
        <FieldLegend variant="label">Faces</FieldLegend>
        <FontsSection theme={theme} onBrowse={onBrowse} />
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Rhythm</FieldLegend>
        <TypographySection theme={theme} baselineOnly={baselineOnly} />
      </FieldSet>
    </div>
  );
}
