import type { ColorPair, Theme } from "@velloo/schema";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { useCanvas } from "../store.ts";
import { ColorSwatch } from "./ColorSwatch.tsx";
import { ContrastReport } from "./ContrastReport.tsx";
import { PresetPicker } from "./PresetPicker.tsx";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
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
  const [vibe, setVibe] = useState("");
  const [seed, setSeed] = useState("");
  const [vibeUseAi, setVibeUseAi] = useState(false);
  const [busy, setBusy] = useState<null | "vibe" | "derive">(null);
  const [status, setStatus] = useState<string | null>(null);
  const themeVersion = useCanvas((s) => s.themeVersion);

  const [openSections, setOpenSections] = useState<string[]>(() => readStoredSections());

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(openSections));
  }, [openSections]);

  const onDerive = async () => {
    if (!seed.trim()) return;
    setBusy("derive");
    setStatus(null);
    try {
      await themeApi.deriveFromColor(seed.trim());
      setStatus(`palette derived from ${seed.trim()}`);
    } catch (err) {
      setStatus(`derive failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onMatchVibe = async () => {
    if (!vibe.trim()) return;
    setBusy("vibe");
    setStatus(null);
    try {
      const r = await themeApi.matchVibe(vibe.trim(), vibeUseAi);
      setStatus(`vibe matched: ${r.matched.description} (${r.matched.source})`);
    } catch (err) {
      setStatus(`match_vibe failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4">
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
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="theme-vibe" className="text-xs text-muted-foreground">
                  match a vibe
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="theme-vibe"
                    type="text"
                    value={vibe}
                    onChange={(e) => setVibe(e.target.value)}
                    placeholder="playful, corporate, forest…"
                    className="flex-1 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onMatchVibe}
                    disabled={busy !== null || !vibe.trim()}
                  >
                    {busy === "vibe" ? "…" : "Match"}
                  </Button>
                </div>
                <Label className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-normal">
                  <Checkbox checked={vibeUseAi} onCheckedChange={(c) => setVibeUseAi(Boolean(c))} />
                  use Claude (requires ANTHROPIC_API_KEY)
                </Label>
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
