import type { Theme } from "@velloo/schema";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  ListChecks,
  type LucideIcon,
  Palette,
  SquareRoundCorner,
  SwatchBook,
  TriangleAlert,
  Type,
} from "lucide-react";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { ContrastReport } from "../ContrastReport.tsx";
import { Loading } from "../Loading.tsx";
import { SeedPalette } from "../ThemeColors.tsx";
import { FontBrowser } from "../typography/FontBrowser.tsx";
import { assignSpec, FontsSection, leadFamily } from "../typography/FontsSection.tsx";
import { TypographySection } from "../typography/TypographySection.tsx";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { FieldLegend, FieldSet } from "../ui/field.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs.tsx";
import { PROPOSE_LANGUAGE_PROMPT } from "./agent-prompt.ts";
import { markLanguageSet } from "./language-set.ts";
import { RolesEditor } from "./RolesEditor.tsx";
import { RulesStep } from "./RulesStep.tsx";
import { radiusLabel, radiusToPx } from "./radius.ts";
import { ShapeStep } from "./ShapeStep.tsx";
import { StartingPoints } from "./StartingPoints.tsx";

type StepId = "colour" | "type" | "shape" | "rules";

const STEPS: ReadonlyArray<{ id: StepId; label: string; icon: LucideIcon; ask: string }> = [
  {
    id: "colour",
    label: "Colour",
    icon: Palette,
    ask: "Pick a direction or a colour of your own to start from, then change any role.",
  },
  {
    id: "type",
    label: "Type",
    icon: Type,
    ask: "Choose the faces and the rhythm. The specimen's ladder follows as you go.",
  },
  {
    id: "shape",
    label: "Shape",
    icon: SquareRoundCorner,
    ask: "How round the corners are, everywhere.",
  },
  {
    id: "rules",
    label: "Rules",
    icon: ListChecks,
    ask: "A few rules in plain words. Optional — but they are what your agent and reviews are held to.",
  },
];

/** How many of the theme's text pairs fail contrast — the one thing worth flagging from afar. */
function useContrastFailures(themeName: string, themeVersion: number): number {
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

function faceOf(theme: Theme, role: string | undefined): string {
  const stack = theme.typography.fontFamily?.[role ?? "sans"];
  return stack ? leadFamily(stack) : "System";
}

async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(PROPOSE_LANGUAGE_PROMPT);
    pushToast({ kind: "success", message: "Prompt copied — paste it to your coding agent." });
  } catch {
    pushToast({
      kind: "info",
      message: "Copy failed — ask your agent to propose a design language.",
    });
  }
}

/**
 * The design-language stage: colour, type, shape and rules, edited beside a
 * specimen of the design's own components.
 *
 * It has two shapes. Someone defining a language for the first time is walked
 * through it one decision at a time, and a step is only "done" once they have
 * been through it. Someone reviewing a language that exists — an agent's
 * proposal, or their own from last month — gets all four laid out to move
 * between, with nothing claiming to be finished or unfinished.
 *
 * Edits are live. Cancel is what undoes them: it puts the theme and rules back
 * as they stood when the stage opened.
 */
export function LanguageStage() {
  const theme = useCanvas((s) => s.theme);
  const themeName = useCanvas((s) => s.themeName);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const rules = useCanvas((s) => s.languageRules);
  const mode = useCanvas((s) => s.languageMode);
  const baseline = useCanvas((s) => s.languageBaseline);
  const folderId = useCanvas((s) => s.design?.folderId);
  const refreshTheme = useCanvas((s) => s.refreshTheme);
  const finishLanguage = useCanvas((s) => s.finishLanguage);
  const cancelLanguage = useCanvas((s) => s.cancelLanguage);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const [step, setStep] = useState<StepId>("colour");
  // Guided only: the furthest step reached. Steps past it are not offered yet.
  const [reached, setReached] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [browsingRole, setBrowsingRole] = useState<string | null>(null);
  const failures = useContrastFailures(themeName, themeVersion);

  if (!theme || !rules || !baseline) {
    return (
      <aside className="w-[360px] shrink-0 border-r bg-card grid place-items-center">
        <Loading size={24} label="Opening the design language…" className="flex-col" />
      </aside>
    );
  }

  if (browsingRole !== null) {
    const stack = theme.typography.fontFamily?.[browsingRole];
    return (
      <aside className="w-[360px] shrink-0 border-r bg-card flex flex-col min-h-0">
        <FontBrowser
          role={browsingRole}
          current={stack ? leadFamily(stack) : undefined}
          onBack={() => setBrowsingRole(null)}
          onPick={(font) => {
            setBrowsingRole(null);
            void themeApi.setFonts(themeName, [assignSpec(browsingRole, font)]).catch((err) => {
              toastError(err, "Could not set the face");
              void refreshTheme();
            });
          }}
        />
      </aside>
    );
  }

  const dirty =
    JSON.stringify(theme) !== JSON.stringify(baseline.theme) ||
    rules.intent !== baseline.rules.intent ||
    JSON.stringify(rules.rules) !== JSON.stringify(baseline.rules.rules);

  const done = () => {
    markLanguageSet(folderId);
    void finishLanguage().catch((err) => toastError(err, "Could not close"));
  };
  const discard = () => {
    setConfirming(false);
    void cancelLanguage().catch((err) => toastError(err, "Could not undo the changes"));
  };

  const index = STEPS.findIndex((s) => s.id === step);
  const current = STEPS[index] ?? STEPS[0];
  const next = STEPS[index + 1];
  const goTo = (target: number) => {
    const to = STEPS[target];
    if (!to) return;
    setStep(to.id);
    setReached((r) => Math.max(r, target));
  };

  const typeset = theme.typography.typesets?.default;
  const radius = radiusToPx(theme.radius.md ?? theme.radius.lg ?? theme.radius.sm);
  const dos = rules.rules.filter((r) => r.kind === "do").length;
  const summaries: Record<StepId, string> = {
    colour:
      failures > 0
        ? `${failures} text ${failures === 1 ? "pair fails" : "pairs fail"} contrast`
        : "Every text pair passes contrast",
    type: `${faceOf(theme, typeset?.fontHeading ?? typeset?.fontBody)} · ${faceOf(theme, typeset?.fontBody)}`,
    shape: radius === null ? "Custom radius" : `${radiusLabel(radius)} · ${radius}px corners`,
    rules:
      rules.rules.length === 0 ? "None stated" : `${dos} do · ${rules.rules.length - dos} don't`,
  };

  return (
    <aside
      data-language-stage={mode}
      className="w-[360px] shrink-0 border-r bg-card flex flex-col min-h-0"
      // Everything here edits the design — match the panes while the daemon is away.
      inert={!wsConnected}
    >
      <header className="flex items-start gap-2.5 border-b p-3">
        <div className="size-8 grid place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
          <SwatchBook className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Design language</div>
          <p className="text-xs text-muted-foreground">
            Changes show at once, on every board. Cancel puts them back.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          // Nothing changed means nothing to put back — and no write to make.
          onClick={() => (dirty ? setConfirming(true) : void finishLanguage())}
        >
          Cancel
        </Button>
        {mode === "review" ? (
          <Button size="sm" onClick={done}>
            Done
          </Button>
        ) : null}
      </header>

      {mode === "guided" ? (
        <div className="flex flex-col gap-2 border-b p-3">
          <Tabs value={step} onValueChange={(v) => setStep(v as StepId)}>
            <TabsList className="h-8 w-full">
              {STEPS.map((s, i) => (
                <TabsTrigger key={s.id} value={s.id} disabled={i > reached} className="text-xs">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Step {index + 1} of {STEPS.length}.
            </span>{" "}
            {current?.ask}
          </p>
        </div>
      ) : (
        <nav aria-label="Design language" className="flex flex-col gap-0.5 border-b p-2">
          {STEPS.map(({ id, label, icon: Icon }) => (
            <Item
              key={id}
              asChild
              size="xs"
              variant={step === id ? "muted" : "default"}
              className="cursor-pointer text-left hover:bg-muted/50"
            >
              <button
                type="button"
                aria-current={step === id ? "page" : undefined}
                onClick={() => setStep(id)}
              >
                <ItemMedia>
                  <Icon
                    className={step === id ? "size-4 text-primary" : "size-4 text-muted-foreground"}
                  />
                </ItemMedia>
                <ItemContent className="gap-0">
                  <ItemTitle className="text-[13px]">{label}</ItemTitle>
                  <ItemDescription className="text-[11px]">{summaries[id]}</ItemDescription>
                </ItemContent>
                {id === "colour" && failures > 0 ? (
                  <ItemActions>
                    <TriangleAlert
                      className="size-3.5 text-destructive"
                      aria-label="Needs attention"
                    />
                  </ItemActions>
                ) : null}
              </button>
            </Item>
          ))}
        </nav>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scroll-stable">
        {step === "colour" ? (
          <div className="flex flex-col gap-5 p-4">
            {/* Where to start from is the first decision of a new language, and
                beside the point once there is one: reviewing a language that
                exists, it waits below the roles, closed, for starting over. */}
            {mode === "guided" ? (
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
              <RolesEditor theme={theme} />
            </FieldSet>
            {mode === "review" ? (
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
            ) : null}
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
        ) : step === "type" ? (
          <div className="flex flex-col gap-5 p-4">
            <FieldSet>
              <FieldLegend variant="label">Faces</FieldLegend>
              <FontsSection theme={theme} onBrowse={setBrowsingRole} />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Rhythm</FieldLegend>
              <TypographySection theme={theme} baselineOnly />
            </FieldSet>
          </div>
        ) : step === "shape" ? (
          <ShapeStep theme={theme} />
        ) : (
          <RulesStep state={rules} />
        )}
      </div>

      {mode === "guided" ? (
        <footer className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => goTo(index - 1)}>
            <ArrowLeft />
            Back
          </Button>
          {next ? (
            <Button size="sm" onClick={() => goTo(index + 1)}>
              Next: {next.label}
              <ArrowRight />
            </Button>
          ) : (
            <Button size="sm" onClick={done}>
              Done
            </Button>
          )}
        </footer>
      ) : (
        <footer className="flex items-center gap-2 border-t p-2">
          <Button variant="ghost" size="xs" onClick={() => void copyPrompt()}>
            <Copy />
            Copy a prompt to have your agent propose one
          </Button>
        </footer>
      )}

      <ConfirmDialog
        open={confirming}
        title="Discard these changes?"
        description="The theme and the rules go back to how they were when you opened the design language."
        confirmLabel="Discard"
        onConfirm={discard}
        onCancel={() => setConfirming(false)}
      />
    </aside>
  );
}
