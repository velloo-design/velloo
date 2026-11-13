import type { Theme } from "@velloo/schema";
import { SwatchBook } from "lucide-react";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ShapeStep } from "./DesignLanguage/ShapeStep.tsx";
import { ColourControls, TypeControls } from "./DesignLanguage/ThemeControls.tsx";
import { LookHeader, LookImagerySection, LookRulesSection } from "./Looks/LookDetails.tsx";
import { LookList } from "./Looks/LookList.tsx";
import { FontBrowser } from "./typography/FontBrowser.tsx";
import { assignSpec, leadFamily } from "./typography/FontsSection.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion.tsx";
import { Button } from "./ui/button.tsx";

interface Props {
  theme: Theme;
}

const SECTION_STORAGE_KEY = "velloo:theme-panel:sections";
const SECTIONS = ["imagery", "rules", "colour", "type", "shape"] as const;
const DEFAULT_OPEN = ["imagery", "colour"];

function readStoredSections(): string[] {
  if (typeof localStorage === "undefined") return DEFAULT_OPEN;
  const raw = localStorage.getItem(SECTION_STORAGE_KEY);
  if (!raw) return DEFAULT_OPEN;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Names from before the rail shared the stage's controls mean nothing now.
      const known = parsed.filter((s) => (SECTIONS as readonly unknown[]).includes(s));
      return known.length > 0 || parsed.length === 0 ? (known as string[]) : DEFAULT_OPEN;
    }
  } catch {
    /* fallthrough */
  }
  return DEFAULT_OPEN;
}

/**
 * The Looks rail: every Look the design has, and the one it shows — by default
 * the board's own, edited in place.
 *
 * A Look's imagery and rules can be read and edited from any board: nothing
 * on screen renders them. Its tokens are another matter. Their controls are
 * the design-language stage's own and are shown only for the board's Look, so
 * what is being changed is always what the frames show — the failure that
 * rule exists for is a rhythm control silently editing a file nothing
 * rendered. The stage is the language itself, with its rules in words and a
 * specimen; this is whichever Look this board uses.
 */
export function ThemePanel({ theme }: Props) {
  const themeName = useCanvas((s) => s.themeName);
  const looks = useCanvas((s) => s.looks);
  const focus = useCanvas((s) => s.lookFocus);
  const refreshTheme = useCanvas((s) => s.refreshTheme);
  const openLanguage = useCanvas((s) => s.openLanguage);
  // Dark roles are edited with the board in dark, so what is being changed is
  // what is on screen — the same pairing the stage keeps with its specimen.
  const designMode = useCanvas((s) => s.designMode);
  const setDesignMode = useCanvas((s) => s.setDesignMode);

  const [openSections, setOpenSections] = useState<string[]>(() => readStoredSections());
  /**
   * The role whose face is being chosen. Non-null swaps the rail for the font
   * browser rather than opening a dialog over the canvas: the preview being
   * browsed is painted on the board, so covering the board would defeat it.
   */
  const [browsingRole, setBrowsingRole] = useState<string | null>(null);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(openSections));
  }, [openSections]);

  if (browsingRole !== null) {
    const stack = theme.typography.fontFamily?.[browsingRole];
    return (
      <div className="flex-1 min-h-0">
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
      </div>
    );
  }

  const trigger = "text-xs uppercase tracking-wider text-muted-foreground hover:no-underline";
  const shown = focus ?? themeName;
  const onBoard = shown === themeName;
  const summary = looks?.find((l) => l.name === shown) ?? {
    name: shown,
    look: null,
    usedByBoards: [],
    swatch: [],
  };
  return (
    <div className="flex-1 overflow-y-auto scroll-stable p-4">
      {/* Which Look the rail is pointed at is the frame for every control below. */}
      <LookList />
      <LookHeader summary={summary} onBoard={onBoard} />
      <Button
        variant="outline"
        size="sm"
        className="mb-3 w-full justify-start"
        title="The whole language: its rules in words, on a specimen of your components"
        onClick={() =>
          void openLanguage("review", shown).catch((err) => toastError(err, "Could not open"))
        }
      >
        <SwatchBook />
        Open the design language
      </Button>
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={(v) => setOpenSections(v)}
        className="flex flex-col gap-1"
      >
        <AccordionItem value="imagery">
          <AccordionTrigger className={trigger}>Imagery</AccordionTrigger>
          <AccordionContent>
            <LookImagerySection name={shown} look={summary.look} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="rules">
          <AccordionTrigger className={trigger}>Rules</AccordionTrigger>
          <AccordionContent>
            <LookRulesSection name={shown} look={summary.look} />
          </AccordionContent>
        </AccordionItem>
        {onBoard ? (
          <>
            <AccordionItem value="colour">
              <AccordionTrigger className={trigger}>Colour</AccordionTrigger>
              <AccordionContent>
                <ColourControls theme={theme} scheme={designMode} onSchemeChange={setDesignMode} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="type">
              <AccordionTrigger className={trigger}>Type</AccordionTrigger>
              <AccordionContent>
                <TypeControls theme={theme} onBrowse={setBrowsingRole} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="shape">
              <AccordionTrigger className={trigger}>Shape</AccordionTrigger>
              <AccordionContent>
                <ShapeStep theme={theme} />
              </AccordionContent>
            </AccordionItem>
          </>
        ) : null}
      </Accordion>
    </div>
  );
}
