import type { Theme } from "@velloo/schema";
import {
  Check,
  Copy,
  ListChecks,
  type LucideIcon,
  Palette,
  SquareRoundCorner,
  SwatchBook,
  TriangleAlert,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SPECIMEN_ID, theme as themeApi } from "../../api.ts";
import { readBoardView } from "../../board-memory.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { ContrastReport } from "../ContrastReport.tsx";
import { Loading } from "../Loading.tsx";
import { PresetPicker } from "../PresetPicker.tsx";
import { SeedPalette, ThemeColorSlots } from "../ThemeColors.tsx";
import { FontBrowser } from "../typography/FontBrowser.tsx";
import { assignSpec, FontsSection, leadFamily } from "../typography/FontsSection.tsx";
import { TypographySection } from "../typography/TypographySection.tsx";
import { Button } from "../ui/button.tsx";
import { FieldLegend, FieldSet } from "../ui/field.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { PROPOSE_LANGUAGE_PROMPT } from "./agent-prompt.ts";
import { RulesStep } from "./RulesStep.tsx";
import { radiusLabel, radiusToPx } from "./radius.ts";
import { ShapeStep } from "./ShapeStep.tsx";

type StepId = "colour" | "type" | "shape" | "rules";

const STEPS: ReadonlyArray<{ id: StepId; label: string; icon: LucideIcon }> = [
  { id: "colour", label: "Colour", icon: Palette },
  { id: "type", label: "Type", icon: Type },
  { id: "shape", label: "Shape", icon: SquareRoundCorner },
  { id: "rules", label: "Rules", icon: ListChecks },
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

/** Long enough for the board to mount and run its own fit, which this then replaces. */
const BOARD_FIT_MS = 120;

/**
 * The first time the specimen is opened, bring the top of its light frame up
 * to a size type can be judged at — a board's default fit shows both frames
 * whole, at a zoom where a 14px label is four pixels tall. A view the person
 * has since chosen for this board is theirs and is left alone.
 */
function useSpecimenCloseUp(): void {
  const onSpecimen = useCanvas((s) => s.currentBoardId === SPECIMEN_ID);
  const hadView = useRef(readBoardView(SPECIMEN_ID) !== null);
  useEffect(() => {
    if (!onSpecimen || hadView.current) return;
    hadView.current = true;
    const timer = setTimeout(() => {
      const s = useCanvas.getState();
      const frame = s.boards[SPECIMEN_ID]?.frames[0];
      if (frame) {
        s.flyToBoardRect({ x: frame.x, y: frame.y, w: frame.w, h: Math.round(frame.w * 0.6) });
      }
    }, BOARD_FIT_MS);
    return () => clearTimeout(timer);
  }, [onSpecimen]);
}

function faceOf(theme: Theme, role: string | undefined, fallback: string): string {
  const stack = theme.typography.fontFamily?.[role ?? fallback];
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
 * The design-language stage: colour, type, shape and rules, edited beside the
 * specimen board so every choice is judged on the design's own components.
 * It replaces the sidebar; the board beside it is the real one, which is why
 * a dragged rhythm control or a browsed face previews exactly as it does from
 * the Theme rail.
 */
export function LanguageStage() {
  const theme = useCanvas((s) => s.theme);
  const presets = useCanvas((s) => s.presets);
  const themeName = useCanvas((s) => s.themeName);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const state = useCanvas((s) => s.designLanguage);
  const refreshLanguage = useCanvas((s) => s.refreshLanguage);
  const refreshTheme = useCanvas((s) => s.refreshTheme);
  const closeLanguage = useCanvas((s) => s.closeLanguage);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const [step, setStep] = useState<StepId>("colour");
  const [browsingRole, setBrowsingRole] = useState<string | null>(null);
  const failures = useContrastFailures(themeName, themeVersion);
  useSpecimenCloseUp();

  // Rules ride the theme's refresh event, so an agent's proposal landing while
  // the stage is open shows up without a reload.
  useEffect(() => {
    if (themeVersion > 0) void refreshLanguage().catch(() => {});
  }, [themeVersion, refreshLanguage]);

  if (!theme || !state) {
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

  const typeset = theme.typography.typesets?.default;
  const radius = radiusToPx(theme.radius.md ?? theme.radius.lg ?? theme.radius.sm);
  const dos = state.rules.rules.filter((r) => r.kind === "do").length;
  const donts = state.rules.rules.length - dos;
  const summaries: Record<StepId, string> = {
    colour:
      failures > 0
        ? `${failures} text ${failures === 1 ? "pair fails" : "pairs fail"} contrast`
        : "Every text pair passes contrast",
    type: `${faceOf(theme, typeset?.fontHeading, "sans")} · ${faceOf(theme, typeset?.fontBody, "sans")}`,
    shape: radius === null ? "Custom radius" : `${radiusLabel(radius)} · ${radius}px corners`,
    rules: state.rules.rules.length === 0 ? "None stated yet" : `${dos} do · ${donts} don't`,
  };

  return (
    <aside
      data-language-stage
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
            Shown on this design's own components. Every board follows it.
          </p>
        </div>
        <Button size="sm" onClick={closeLanguage}>
          Done
        </Button>
      </header>

      <nav aria-label="Design language steps" className="flex flex-col gap-0.5 border-b p-2">
        {STEPS.map(({ id, label, icon: Icon }) => {
          const warn = id === "colour" && failures > 0;
          return (
            <Item
              key={id}
              asChild
              size="xs"
              variant={step === id ? "muted" : "default"}
              className="cursor-pointer text-left hover:bg-muted/50"
            >
              <button
                type="button"
                aria-current={step === id ? "step" : undefined}
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
                <ItemActions>
                  {warn ? (
                    <TriangleAlert
                      className="size-3.5 text-destructive"
                      aria-label="Needs attention"
                    />
                  ) : id === "rules" && state.rules.rules.length === 0 ? null : (
                    <Check className="size-3.5 text-muted-foreground/70" aria-hidden />
                  )}
                </ItemActions>
              </button>
            </Item>
          );
        })}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-stable">
        {step === "colour" ? (
          <div className="flex flex-col gap-5 p-4">
            <FieldSet>
              <FieldLegend variant="label">Starting point</FieldLegend>
              <PresetPicker presets={presets} activeName={theme.name} />
              <SeedPalette />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Roles</FieldLegend>
              <ThemeColorSlots theme={theme} />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Contrast</FieldLegend>
              <ContrastReport bumpKey={themeVersion} />
            </FieldSet>
          </div>
        ) : step === "type" ? (
          <div className="flex flex-col gap-5 p-4">
            <FieldSet>
              <FieldLegend variant="label">Faces</FieldLegend>
              <FontsSection theme={theme} onBrowse={setBrowsingRole} />
            </FieldSet>
            <FieldSet>
              <FieldLegend variant="label">Rhythm</FieldLegend>
              <TypographySection theme={theme} />
            </FieldSet>
          </div>
        ) : step === "shape" ? (
          <ShapeStep theme={theme} />
        ) : (
          <RulesStep state={state.rules} />
        )}
      </div>

      <footer className="flex items-center gap-2 border-t p-2">
        <Button variant="ghost" size="xs" onClick={() => void copyPrompt()}>
          <Copy />
          Copy a prompt to have your agent propose one
        </Button>
      </footer>
    </aside>
  );
}
