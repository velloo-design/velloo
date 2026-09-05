/**
 * The HUD's control widgets.
 *
 * Two rules run through all of them. First, the vocabulary names the outcome
 * wherever that beats the property — *Fill*, *Hug*, *Fixed*, *Corners*. Second,
 * every field wears its provenance — a value the node doesn't own reads muted
 * whether it comes from the theme or is just the browser default, and a value
 * changed here gets a dot and a way back. Without that second half the bar is
 * just a smaller devtools.
 */

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parseTriplet } from "../../color.ts";
import type { Choice } from "../../hud/control-set.ts";
import type { WriteContext } from "../../hud/use-control-write.ts";
import type { Origin } from "../../hud/values.ts";
import { ColorWheel, HexInput, type Hsv, hexToHsv, hsvToHex } from "../color-picker.tsx";
import { IconGrid, LUCIDE } from "../IconPicker.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

// ------------------------------------------------------------- field chrome

export interface FieldChromeProps {
  label: string;
  origin: Origin;
  /** What the theme says, shown as "was 40" once the value is overridden. */
  themeValue?: string | number | null | undefined;
  /** The theme style behind it, e.g. "Heading 1". */
  source?: string | undefined;
  width: number;
  /** A caveat about this value, e.g. a responsive utility the bar doesn't edit. */
  note?: string | undefined;
  onReset?: (() => void) | undefined;
  children: React.ReactNode;
}

/** In the pane the field fills its grid cell; on the bar it takes its declared width. */
const fieldWidth = (width: number) =>
  width > 0 ? { className: "shrink-0", style: { width } } : { className: "min-w-0" };

/**
 * Label + provenance + control. The reset affordance only exists when there is
 * something to reset to, so a `plain` slot never offers a meaningless revert.
 */
export function HudField({
  label,
  origin,
  themeValue,
  source,
  width,
  note,
  onReset,
  children,
}: FieldChromeProps) {
  const changed = origin === "changed";
  const provenance =
    changed && themeValue !== null && themeValue !== undefined
      ? `${source ?? "Theme"} sets ${themeValue}`
      : origin === "theme" && source
        ? `From ${source}`
        : null;
  const hint = [provenance, note].filter(Boolean).join(" — ") || null;

  const labelEl = (
    <span
      className={`truncate ${changed ? "text-foreground font-medium" : "text-muted-foreground"}`}
    >
      {label}
    </span>
  );

  const box = fieldWidth(width);

  return (
    <div className={`flex flex-col gap-1 ${box.className}`} style={box.style}>
      <div className="flex h-3.5 items-center gap-1 px-0.5 text-[10px] leading-none">
        {changed ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
        {note ? <span className="shrink-0 text-muted-foreground">@</span> : null}
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>{labelEl}</TooltipTrigger>
            <TooltipContent side="top">{hint}</TooltipContent>
          </Tooltip>
        ) : (
          labelEl
        )}
        {changed && onReset ? (
          <button
            type="button"
            aria-label={`Reset ${label}`}
            title={hint ?? `Reset ${label}`}
            className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onReset}
          >
            <RotateCcw size={9} />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const CONTROL = "h-7 w-full rounded-md border bg-background text-xs";

/** What a field shows when nothing — not the node, not the theme — has a value. */
const EMPTY = "—";

// ------------------------------------------------------------ scrub numbers

interface NumberProps {
  value: number | null;
  /** Shown greyed when there's no value of our own — the measured or inherited number. */
  ghost?: number | string | null | undefined;
  /** The number on show isn't the node's own — dim it so it doesn't read as an edit. */
  muted?: boolean | undefined;
  onChange(next: number, ctx?: WriteContext): void;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** Pointer px per step. Ratios need a slower gear than pixel sizes. */
  gear?: number;
  suffix?: string;
}

/**
 * A number you can drag. Dragging the unit chip scrubs; the input still takes
 * a typed value and arrow keys, because "nudge by one" is the thing precision
 * work actually needs and a drag can't promise it.
 */
export function NumberField({
  value,
  ghost,
  muted = false,
  onChange,
  min,
  max,
  step = 1,
  gear = 3,
  suffix = "px",
}: NumberProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const scrubbing = useRef<{ startX: number; startValue: number; gesture: string } | null>(null);

  const clamp = (n: number) => {
    let out = n;
    if (min !== undefined) out = Math.max(min, out);
    if (max !== undefined) out = Math.min(max, out);
    // Kill float dust from fractional steps: 1.05 + 0.05 is not 1.1.
    return Math.round(out * 1000) / 1000;
  };

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setDraft(null);
  };

  const base = value ?? (typeof ghost === "number" ? ghost : 0);
  const shown = draft ?? (value === null ? "" : String(value));

  return (
    <div
      className={`${CONTROL} flex items-center overflow-hidden focus-within:ring-1 focus-within:ring-ring`}
    >
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder={ghost === null || ghost === undefined ? EMPTY : String(ghost)}
        className={`min-w-0 flex-1 bg-transparent px-2 tabular-nums outline-none placeholder:text-muted-foreground/60 ${
          muted ? "text-muted-foreground" : ""
        }`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const mult = e.shiftKey ? 10 : 1;
            const next = clamp(base + (e.key === "ArrowUp" ? step : -step) * mult);
            setDraft(null);
            onChange(next);
          }
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Drag to adjust"
        className="h-full shrink-0 cursor-ew-resize select-none border-l px-1.5 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          // One id for the whole drag: the writes it streams are a single act,
          // so releasing the mouse leaves one thing to undo.
          scrubbing.current = {
            startX: e.clientX,
            startValue: base,
            gesture: `scrub-${e.pointerId}-${Date.now()}`,
          };
        }}
        onPointerMove={(e) => {
          const drag = scrubbing.current;
          if (!drag) return;
          const steps = Math.round((e.clientX - drag.startX) / gear);
          if (steps === 0) return;
          const next = clamp(drag.startValue + steps * step);
          if (next !== value) onChange(next, { gesture: drag.gesture });
        }}
        onPointerUp={(e) => {
          scrubbing.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
      >
        {suffix}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ choices

interface ChoiceProps {
  value: string | null;
  ghost?: string | null | undefined;
  /** The option on show isn't the node's own — dim it. */
  muted?: boolean | undefined;
  choices: readonly Choice[];
  onChange(next: string): void;
  placeholder?: string;
}

export function ChoiceField({
  value,
  ghost,
  muted = false,
  choices,
  onChange,
  placeholder,
}: ChoiceProps) {
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger
        className={`${CONTROL} min-h-0 px-2 [&>span]:truncate ${
          muted || value === null ? "text-muted-foreground" : ""
        }`}
      >
        <SelectValue placeholder={ghost ? labelFor(choices, ghost) : (placeholder ?? EMPTY)} />
      </SelectTrigger>
      <SelectContent>
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value} className="text-xs">
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function labelFor(choices: readonly Choice[], value: string | null | undefined): string {
  if (!value) return EMPTY;
  return choices.find((c) => c.value === value)?.label ?? value;
}

// --------------------------------------------------------------------- size

interface SizeProps {
  mode: "full" | "fit" | "fixed" | null;
  px: number | null;
  /** What the element actually measures right now, so Fill/Hug still show a number. */
  measured?: number | null | undefined;
  /** The node sets no size of its own — what's shown is measured, not chosen. */
  muted?: boolean | undefined;
  choices: readonly Choice[];
  onMode(next: string): void;
  onPx(next: number, ctx?: WriteContext): void;
}

/**
 * Fill / Hug / Fixed, with the number always visible. Under Fill or Hug the box
 * shows the measured px greyed out — typing over it is what makes the size
 * fixed, which is the same gesture as dragging a resize handle.
 */
export function SizeField({ mode, px, measured, muted = false, choices, onMode, onPx }: SizeProps) {
  return (
    <div className="flex items-stretch gap-1">
      <div className="w-[70px] shrink-0">
        <ChoiceField
          value={mode}
          muted={muted}
          choices={choices}
          onChange={onMode}
          placeholder="Auto"
        />
      </div>
      <div className="min-w-0 flex-1">
        <NumberField
          value={mode === "fixed" ? px : null}
          ghost={mode === "fixed" ? null : (measured ?? null)}
          onChange={onPx}
          min={0}
          max={4096}
        />
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- align

export function AlignField({
  value,
  ghost,
  muted = false,
  choices,
  onChange,
}: {
  value: string | null;
  ghost?: string | null | undefined;
  /** The active option isn't the node's own — show it held, not chosen. */
  muted?: boolean | undefined;
  choices: readonly Choice[];
  onChange(next: string): void;
}) {
  const active = value ?? ghost ?? null;
  return (
    <div className={`${CONTROL} flex items-stretch overflow-hidden p-0.5`}>
      {choices.map((c) => {
        const on = active === c.value;
        return (
          <button
            key={c.value}
            type="button"
            title={c.label}
            aria-pressed={on}
            className={`flex-1 rounded-sm text-[10px] ${
              on
                ? muted || value === null
                  ? "bg-muted text-muted-foreground"
                  : "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
            onClick={() => onChange(c.value)}
          >
            {c.label.charAt(0)}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------- colour

interface ColorProps {
  value: string | null;
  ghost?: string | null | undefined;
  /** The colour on show isn't the node's own — dim the label. */
  muted?: boolean | undefined;
  choices: readonly Choice[];
  /** Paints a token the design theme's way — the canvas's own CSS vars are a different theme. */
  resolve(token: string | null): string | null;
  onChange(next: string, ctx?: WriteContext): void;
}

const CUSTOM_FALLBACK = "#7c3aed";

/**
 * Named theme tokens first, a wheel second.
 *
 * The tokens are a list, not a grid of dots: a theme routinely has four tokens
 * that paint the same near-white, and without the name and the resolved value
 * beside each one they are unpickable. Reaching for a raw colour is allowed —
 * it's a design canvas — but it lives behind a tab, so a token stays the path
 * of least resistance.
 */
export function ColorField({
  value,
  ghost,
  muted = false,
  choices,
  resolve,
  onChange,
}: ColorProps) {
  const [open, setOpen] = useState(false);
  const shown = value ?? ghost ?? null;
  const isCustom = shown?.startsWith("[") === true;
  const [tab, setTab] = useState<"theme" | "custom">("theme");
  const [hsv, setHsv] = useState<Hsv>({ h: 265, s: 0.75, v: 0.9 });
  // Dragging on the wheel writes on every move. One id per opening of the
  // popover makes the whole hunt for a colour a single thing to undo.
  const gesture = useRef("");

  useEffect(() => {
    if (!open) return;
    gesture.current = `color-${Date.now()}`;
    setTab(isCustom ? "custom" : "theme");
    const current = hexToHsv(resolve(shown) ?? CUSTOM_FALLBACK);
    if (current) setHsv(current);
  }, [open, isCustom, shown, resolve]);

  const custom = (next: Hsv) => {
    setHsv(next);
    onChange(`[${hsvToHex(next)}]`, { gesture: gesture.current });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`${CONTROL} flex items-center gap-1.5 px-1.5 hover:bg-accent/50 ${
          muted || value === null ? "text-muted-foreground" : ""
        }`}
      >
        <Swatch css={resolve(shown)} unset={shown === null} />
        <span className="truncate">{shown ? labelFor(choices, shown) : EMPTY}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex gap-1 border-b p-1.5">
          {(["theme", "custom"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`flex-1 rounded-sm py-1 text-xs capitalize ${
                tab === t
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "theme" ? (
          <div className="max-h-64 overflow-y-auto p-1">
            {choices.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">This theme declares no colours.</p>
            ) : null}
            {choices.map((c) => {
              const css = c.swatch ?? resolve(c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs hover:bg-accent/50 ${
                    shown === c.value ? "bg-accent text-accent-foreground" : ""
                  }`}
                  onClick={() => {
                    onChange(c.value);
                    setOpen(false);
                  }}
                >
                  <Swatch css={css} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {hexOf(css)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <ColorWheel value={hsv} onChange={custom} />
            <HexInput
              hex={hsvToHex(hsv)}
              onChange={(next) => {
                const parsed = hexToHsv(next);
                if (parsed) custom(parsed);
              }}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** The hex a resolved token paints, for the readout beside its name. */
function hexOf(css: string | null): string {
  if (!css) return "";
  return parseTriplet(css)?.hex.toUpperCase() ?? "";
}

/**
 * A resolved colour. Nothing chosen reads as an empty ring; a token the theme
 * never declared reads as hatched, so "unset" and "set to something I can't
 * paint" stay distinguishable — painting the canvas's own `--color-*` used to
 * blur both into a confident wrong colour.
 */
function Swatch({ css, unset = false }: { css: string | null; unset?: boolean }) {
  return (
    <span
      className="size-4 shrink-0 rounded-full border border-border/70"
      style={
        css
          ? { background: css }
          : unset
            ? undefined
            : {
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--muted-foreground) 0 2px, transparent 2px 5px)",
              }
      }
    />
  );
}

// --------------------------------------------------------------------- icon

/**
 * The bar's icon control: the glyph itself plus its name, in one field. The
 * full picker is a popover — a grid of glyphs in a bar-height field is not a
 * thing that fits.
 */
export function IconField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange(next: string): void;
}) {
  const [open, setOpen] = useState(false);
  const Glyph = value ? LUCIDE[value] : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`${CONTROL} flex items-center gap-1.5 px-1.5 hover:bg-accent/50 ${
          value ? "" : "text-muted-foreground"
        }`}
      >
        <span className="grid size-4 shrink-0 place-items-center">
          {Glyph ? <Glyph size={14} strokeWidth={2} /> : "—"}
        </span>
        <span className="truncate">{value ? spaceCase(value) : "Pick an icon"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <IconGrid
          value={value}
          options={options}
          onPick={(name) => {
            onChange(name);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** `AlignVerticalSpaceAround` → `Align vertical space around`. */
function spaceCase(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0) + spaced.slice(1).toLowerCase();
}

// ---------------------------------------------------------------- free text

export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange(next: string): void;
  placeholder?: string | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      value={draft ?? value}
      placeholder={placeholder}
      className={`${CONTROL} px-2 outline-none focus:ring-1 focus:ring-ring`}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

// ------------------------------------------------------------------ toggles

export function ToggleField({
  value,
  onChange,
}: {
  value: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`${CONTROL} px-2 text-left ${value ? "" : "text-muted-foreground"}`}
      onClick={() => onChange(!value)}
    >
      {value ? "On" : "Off"}
    </button>
  );
}

// -------------------------------------------------------------------- entry

/** A control whose value is too big for the bar — opens something larger. */
export function OpenerField({ summary, onOpen }: { summary: string | null; onOpen(): void }) {
  return (
    <button
      type="button"
      className={`${CONTROL} truncate px-2 text-left hover:bg-accent/50 ${
        summary ? "" : "text-muted-foreground"
      }`}
      onClick={onOpen}
      title={summary ?? undefined}
    >
      {summary ?? "Describe…"}
    </button>
  );
}
