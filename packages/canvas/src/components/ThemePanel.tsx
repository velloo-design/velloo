import type { ColorPair, Theme } from "@velloo/schema";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { ColorSwatch } from "./ColorSwatch.tsx";
import { ContrastReport } from "./ContrastReport.tsx";
import { PresetPicker } from "./PresetPicker.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";
import { FontBrowser } from "./typography/FontBrowser.tsx";
import { assignSpec, FontsSection, leadFamily } from "./typography/FontsSection.tsx";
import { TypographySection } from "./typography/TypographySection.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

interface Props {
  theme: Theme;
  presets: string[];
}

interface Slot {
  key: keyof Theme["colors"];
  label: string;
  /** Whether this slot supports a `.foreground` pair. */
  pair: boolean;
}

const SLOTS: Slot[] = [
  { key: "background", label: "Background", pair: false },
  { key: "foreground", label: "Foreground", pair: false },
  { key: "primary", label: "Primary", pair: true },
  { key: "secondary", label: "Secondary", pair: true },
  { key: "muted", label: "Muted", pair: true },
  { key: "accent", label: "Accent", pair: true },
  { key: "destructive", label: "Destructive", pair: true },
  { key: "card", label: "Card", pair: true },
  { key: "popover", label: "Popover", pair: true },
  { key: "border", label: "Border", pair: false },
  { key: "input", label: "Input", pair: false },
  { key: "ring", label: "Ring", pair: false },
];

function defaultOf(value: ColorPair | string | undefined): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.DEFAULT;
  return "";
}

function foregroundOf(value: ColorPair | string | undefined): string | null {
  if (value && typeof value === "object" && value.foreground) return value.foreground;
  return null;
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
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState<null | "derive">(null);
  const [status, setStatus] = useState<string | null>(null);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const themeName = useCanvas((s) => s.themeName);
  const refreshTheme = useCanvas((s) => s.refreshTheme);

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

  const onDerive = async () => {
    if (!seed.trim()) return;
    setBusy("derive");
    setStatus(null);
    try {
      await themeApi.deriveFromColor(themeName, seed.trim());
      setStatus(`palette derived from ${seed.trim()}`);
    } catch (err) {
      setStatus(`derive failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

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
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="theme-seed" className="text-xs text-muted-foreground">
                  derive palette from color
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="theme-seed"
                    type="text"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    placeholder="#7c3aed or oklch(...)"
                    spellCheck={false}
                    className="flex-1 text-xs font-mono"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDerive}
                    disabled={busy !== null || !seed.trim()}
                  >
                    {busy === "derive" ? "…" : "Apply"}
                  </Button>
                </div>
              </div>
              {status ? <div className="text-[10px] text-muted-foreground">{status}</div> : null}
            </div>
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
            <div className="flex flex-col gap-3">
              {SLOTS.map((slot) => {
                const v = theme.colors[slot.key];
                const def = defaultOf(v);
                if (!def) return null;
                const fg = foregroundOf(v);
                return (
                  <div key={slot.key} className="flex flex-col gap-1.5">
                    <ColorSwatch
                      label={slot.label}
                      tokenPath={
                        slot.pair && typeof v === "object"
                          ? `colors.${slot.key}.DEFAULT`
                          : `colors.${slot.key}`
                      }
                      value={def}
                    />
                    {slot.pair && fg ? (
                      <div className="pl-9">
                        <ColorSwatch
                          label={`${slot.label} fg`}
                          tokenPath={`colors.${slot.key}.foreground`}
                          value={fg}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
