import type { Theme } from "@velloo/schema";
import { SwatchBook } from "lucide-react";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ContrastReport } from "./ContrastReport.tsx";
import { PresetPicker } from "./PresetPicker.tsx";
import { SeedPalette, ThemeColorSlots } from "./ThemeColors.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";
import { FontBrowser } from "./typography/FontBrowser.tsx";
import { assignSpec, FontsSection, leadFamily } from "./typography/FontsSection.tsx";
import { TypographySection } from "./typography/TypographySection.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion.tsx";
import { Button } from "./ui/button.tsx";

interface Props {
  theme: Theme;
  presets: string[];
}

const SECTION_STORAGE_KEY = "velloo:theme-panel:sections";
const DEFAULT_OPEN = ["presets", "generate", "accessibility"];

function readStoredSections(): string[] {
  if (typeof localStorage === "undefined") return DEFAULT_OPEN;
  const raw = localStorage.getItem(SECTION_STORAGE_KEY);
  if (!raw) return DEFAULT_OPEN;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    /* fallthrough */
  }
  return DEFAULT_OPEN;
}

export function ThemePanel({ theme, presets }: Props) {
  const themeVersion = useCanvas((s) => s.themeVersion);
  const themeName = useCanvas((s) => s.themeName);
  const refreshTheme = useCanvas((s) => s.refreshTheme);
  const openLanguage = useCanvas((s) => s.openLanguage);

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

  return (
    <div className="flex-1 overflow-y-auto scroll-stable p-4">
      {/* Named after what it edits, above everything that edits it: which theme
          file the rail is pointed at is the frame for every control below. */}
      <ThemeSwitcher />
      <Button
        variant="outline"
        size="sm"
        className="mb-3 w-full justify-start"
        onClick={() =>
          void openLanguage("review").catch((err) => toastError(err, "Could not open"))
        }
      >
        <SwatchBook />
        Design language
      </Button>
      <Accordion
        type="multiple"
        value={openSections}
        onValueChange={(v) => setOpenSections(v)}
        className="flex flex-col gap-1"
      >
        <AccordionItem value="presets">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Presets
          </AccordionTrigger>
          <AccordionContent>
            <PresetPicker presets={presets} activeName={theme.name} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="generate">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Generate
          </AccordionTrigger>
          <AccordionContent>
            <SeedPalette />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="accessibility">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Accessibility
          </AccordionTrigger>
          <AccordionContent>
            <ContrastReport bumpKey={themeVersion} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="fonts">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Fonts
          </AccordionTrigger>
          <AccordionContent>
            <FontsSection theme={theme} onBrowse={setBrowsingRole} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="typography">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Typography
          </AccordionTrigger>
          <AccordionContent>
            <TypographySection theme={theme} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="colors">
          <AccordionTrigger className="text-xs uppercase tracking-wider text-muted-foreground hover:no-underline">
            Colors
          </AccordionTrigger>
          <AccordionContent>
            <ThemeColorSlots theme={theme} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
