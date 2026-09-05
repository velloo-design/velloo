/**
 * The colour surface behind the HUD's colour field.
 *
 * Two ways to pick, kept apart on purpose. **Theme** is the list of tokens the
 * design actually declares, each one named and showing what it resolves to —
 * a design theme has several tokens that paint the same near-white, and a grid
 * of bare dots made them indistinguishable and unnameable. **Custom** is a
 * wheel for the times a token isn't the answer; it sits behind a tab rather
 * than beside the swatches so reaching for a raw colour stays a decision.
 *
 * The wheel is HSV: angle is hue, distance from the centre is saturation, and
 * the slider under it is value. Colours are converted through culori, which is
 * already how the theme panel speaks colour.
 */

import { converter, formatHex, parse } from "culori";
import { useCallback, useEffect, useRef, useState } from "react";

const toRgb = converter("rgb");
const toHsv = converter("hsv");

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToHex({ h, s, v }: Hsv): string {
  return formatHex(toRgb({ mode: "hsv", h, s, v })) ?? "#000000";
}

/** Any CSS colour → HSV, or null when it isn't one we can read. */
export function hexToHsv(css: string): Hsv | null {
  const parsed = parse(css);
  if (!parsed) return null;
  const hsv = toHsv(parsed);
  return { h: hsv.h ?? 0, s: hsv.s ?? 0, v: hsv.v ?? 0 };
}

const WHEEL = 160;
const RADIUS = WHEEL / 2;

/** Hue ramp laid out clockwise from 3 o'clock, so it matches `atan2(dy, dx)`. */
const HUE_RING = `conic-gradient(from 90deg, ${[0, 60, 120, 180, 240, 300, 360]
  .map((h) => `hsl(${h} 100% 50%)`)
  .join(", ")})`;

interface WheelProps {
  value: Hsv;
  onChange(next: Hsv): void;
}

/**
 * Hue + saturation on a disc, value on a slider. Both track the pointer through
 * capture so a drag that leaves the control keeps painting — dragging past the
 * rim is how you pin full saturation.
 */
export function ColorWheel({ value, onChange }: WheelProps) {
  const disc = useRef<HTMLDivElement>(null);

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const box = disc.current?.getBoundingClientRect();
      if (!box) return;
      const dx = clientX - (box.left + RADIUS);
      const dy = clientY - (box.top + RADIUS);
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const s = Math.min(1, Math.hypot(dx, dy) / RADIUS);
      onChange({ ...value, h, s });
    },
    [onChange, value],
  );

  const angle = (value.h * Math.PI) / 180;
  const thumbX = RADIUS + Math.cos(angle) * value.s * RADIUS;
  const thumbY = RADIUS + Math.sin(angle) * value.s * RADIUS;
  const hex = hsvToHex(value);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={disc}
        role="application"
        aria-label="Hue and saturation"
        className="relative cursor-crosshair rounded-full border border-border/60"
        style={{
          width: WHEEL,
          height: WHEEL,
          // Saturation fades linearly to white at the centre, matching `s = r/R`.
          // Spelled with an explicit transparent white — bare `transparent`
          // interpolates through transparent *black* and greys the mid-ring.
          backgroundImage: `radial-gradient(circle at center, #fff 0%, rgba(255,255,255,0) 100%), ${HUE_RING}`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0) return;
          pick(e.clientX, e.clientY);
        }}
      >
        {/* The disc stays at full value: dimming it to match a dark colour
            turns the whole picker black and there is nothing left to aim at.
            Brightness lives on the slider, and the thumb wears the real
            resulting colour. */}
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{ left: thumbX, top: thumbY, background: hex }}
        />
      </div>

      <label className="flex w-full items-center gap-2">
        <span className="sr-only">Brightness</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value.v}
          onChange={(e) => onChange({ ...value, v: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer appearance-none rounded-full border border-border/60 [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-transparent [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{
            backgroundImage: `linear-gradient(to right, #000, ${hsvToHex({ ...value, v: 1 })})`,
          }}
        />
      </label>
    </div>
  );
}

/**
 * The hex field under the wheel. It keeps its own draft so a half-typed `#7c3`
 * isn't parsed into something the user didn't mean; the wheel only moves once
 * the text is a colour.
 */
export function HexInput({ hex, onChange }: { hex: string; onChange(next: string): void }) {
  const [draft, setDraft] = useState(hex);
  useEffect(() => setDraft(hex), [hex]);

  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
      <span
        className="size-3.5 shrink-0 rounded-full border border-border/70"
        style={{ background: parse(draft) ? draft : hex }}
      />
      <input
        value={draft}
        spellCheck={false}
        aria-label="Hex"
        className="h-7 min-w-0 flex-1 bg-transparent font-mono text-xs uppercase outline-none"
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const parsed = parse(next.startsWith("#") ? next : `#${next}`);
          if (parsed) onChange(formatHex(toRgb(parsed)) ?? hex);
        }}
      />
    </div>
  );
}
