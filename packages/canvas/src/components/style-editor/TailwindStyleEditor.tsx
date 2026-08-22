import { ArrowDown, ArrowRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mutate } from "../../api.ts";
import { pathFromString } from "../../path.ts";
import {
  argToPx,
  type BoxSides,
  type ParsedClasses,
  parseClasses,
  pxToArg,
  serializeClasses,
  type TwModel,
} from "../../style-editor/tailwind-classes.ts";
import {
  AddRow,
  BoxModel,
  Chip,
  ColorField,
  FieldRow,
  MiniSelect,
  NumberField,
  Section,
  Segmented,
  type Side,
} from "./controls.tsx";

interface Props {
  initialValue: string;
  screenId: string;
  path: string;
  debounceMs: number;
}

const DISPLAY = [
  { value: "block", label: "block" },
  { value: "flex", label: "flex" },
  { value: "grid", label: "grid" },
  { value: "inline-flex", label: "inline" },
];
const DIRECTION = [
  { value: "row", icon: <ArrowRight className="size-3.5" />, title: "row" },
  { value: "col", icon: <ArrowDown className="size-3.5" />, title: "column" },
];
const JUSTIFY: Array<[string, string?]> = [
  ["start"],
  ["center"],
  ["end"],
  ["between"],
  ["around"],
  ["evenly"],
];
const ITEMS: Array<[string, string?]> = [["start"], ["center"], ["end"], ["stretch"], ["baseline"]];
const SIZE: Array<[string, string?]> = [
  ["xs"],
  ["sm"],
  ["base"],
  ["lg"],
  ["xl"],
  ["2xl"],
  ["3xl"],
  ["4xl"],
];
const WEIGHT: Array<[string, string?]> = [
  ["normal"],
  ["medium"],
  ["semibold"],
  ["bold"],
  ["light"],
];
const LEADING: Array<[string, string?]> = [
  ["none"],
  ["tight"],
  ["snug"],
  ["normal"],
  ["relaxed"],
  ["loose"],
];
const TRACKING: Array<[string, string?]> = [
  ["tighter"],
  ["tight"],
  ["normal"],
  ["wide"],
  ["wider"],
  ["widest"],
];
const ALIGN = [
  { value: "left", label: "L" },
  { value: "center", label: "C" },
  { value: "right", label: "R" },
  { value: "justify", label: "J" },
];
const RADIUS: Array<[string, string?]> = [
  ["sm"],
  ["", "rounded"],
  ["md"],
  ["lg"],
  ["xl"],
  ["2xl"],
  ["full"],
];
const BORDER_W: Array<[string, string?]> = [
  ["", "1px"],
  ["0", "0"],
  ["2", "2px"],
  ["4", "4px"],
  ["8", "8px"],
];
const SIZING: Array<[string, string?]> = [
  ["auto"],
  ["full"],
  ["fit"],
  ["screen"],
  ["min"],
  ["max"],
];

const NONE = "—"; // an em-dash sentinel for "unset"

/** Build a MiniSelect option list with a leading "unset" entry, and inject the
 *  current value if it isn't already one of the presets (so arbitrary values
 *  aren't silently dropped on the next edit). */
function withNone(
  opts: Array<[string, string?]>,
  current: string | undefined,
): Array<[string, string?]> {
  const all = [[NONE, NONE] as [string, string?], ...opts];
  if (current !== undefined && !opts.some(([v]) => v === current)) all.push([current, current]);
  return all;
}

function sidesDisplay(sides: BoxSides): Record<Side, string> {
  const one = (a?: string) => {
    const px = argToPx(a);
    return px !== null ? String(px) : (a ?? "");
  };
  return {
    top: one(sides.top),
    right: one(sides.right),
    bottom: one(sides.bottom),
    left: one(sides.left),
  };
}

/** Interpret a box-model side edit: blank clears it, a bare number is px (snapped
 *  to the scale), anything else is taken as a literal Tailwind argument. */
function sideToArg(value: string): string | undefined {
  const v = value.trim();
  if (v === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) return pxToArg(Number(v));
  return v;
}

export function TailwindStyleEditor({ initialValue, screenId, path, debounceMs }: Props) {
  const [parsed, setParsed] = useState<ParsedClasses>(() => parseClasses(initialValue));
  const [adding, setAdding] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const commit = (next: ParsedClasses) => {
    setParsed(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void mutate
        .applyClasses({ screenId, path: pathFromString(path), classes: serializeClasses(next) })
        .catch(() => undefined);
    }, debounceMs);
  };

  const m = parsed.model;
  const setModel = (patch: Partial<TwModel>) => commit({ ...parsed, model: { ...m, ...patch } });
  const setSide = (box: "padding" | "margin", side: Side, value: string) =>
    setModel({ [box]: { ...m[box], [side]: sideToArg(value) } } as Partial<TwModel>);

  const chips = serializeClasses(parsed).split(/\s+/).filter(Boolean);
  const removeChip = (cls: string) => {
    const next = chips.filter((c) => c !== cls).join(" ");
    commit(parseClasses(next));
  };
  const addClass = () => {
    const v = adding.trim();
    if (!v) return;
    commit(parseClasses(`${serializeClasses(parsed)} ${v}`));
    setAdding("");
  };

  return (
    <div className="-mx-4 -mb-4 flex flex-col">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2">
        <span className="text-[11px] text-foreground">Controls ⇄ classes — edit either side</span>
      </div>

      <Section title="Layout">
        <FieldRow label="Display">
          <Segmented
            value={m.display}
            onChange={(v) => setModel({ display: v })}
            options={DISPLAY}
          />
        </FieldRow>
        <FieldRow label="Direction">
          <Segmented
            value={m.flexDirection}
            onChange={(v) => setModel({ flexDirection: v })}
            options={DIRECTION}
          />
        </FieldRow>
        <FieldRow label="Justify">
          <MiniSelect
            value={m.justify ?? NONE}
            onChange={(v) => setModel({ justify: v === NONE ? undefined : v })}
            options={withNone(JUSTIFY, m.justify)}
          />
        </FieldRow>
        <FieldRow label="Align">
          <MiniSelect
            value={m.items ?? NONE}
            onChange={(v) => setModel({ items: v === NONE ? undefined : v })}
            options={withNone(ITEMS, m.items)}
          />
        </FieldRow>
        <FieldRow label="Gap">
          <NumberField
            value={argToPx(m.gap) !== null ? String(argToPx(m.gap)) : (m.gap ?? "")}
            onChange={(v) => setModel({ gap: sideToArg(v) })}
            unit="px"
          />
        </FieldRow>
      </Section>

      <Section title="Spacing">
        <BoxModel
          contentLabel="content"
          padding={sidesDisplay(m.padding)}
          margin={sidesDisplay(m.margin)}
          onPadding={(s, v) => setSide("padding", s, v)}
          onMargin={(s, v) => setSide("margin", s, v)}
        />
        <p className="text-[10px] text-muted-foreground">
          px snaps to the spacing scale (16 → p-4); off-scale → p-[25px].
        </p>
      </Section>

      <Section title="Sizing">
        <FieldRow label="Width">
          <MiniSelect
            value={m.width ?? NONE}
            onChange={(v) => setModel({ width: v === NONE ? undefined : v })}
            options={withNone(SIZING, m.width)}
          />
        </FieldRow>
        <FieldRow label="Height">
          <MiniSelect
            value={m.height ?? NONE}
            onChange={(v) => setModel({ height: v === NONE ? undefined : v })}
            options={withNone(SIZING, m.height)}
          />
        </FieldRow>
      </Section>

      <Section title="Typography">
        <FieldRow label="Size">
          <MiniSelect
            value={m.fontSize ?? NONE}
            onChange={(v) => setModel({ fontSize: v === NONE ? undefined : v })}
            options={withNone(SIZE, m.fontSize)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        <FieldRow label="Weight">
          <MiniSelect
            value={m.fontWeight ?? NONE}
            onChange={(v) => setModel({ fontWeight: v === NONE ? undefined : v })}
            options={withNone(WEIGHT, m.fontWeight)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        <FieldRow label="Leading">
          <MiniSelect
            value={m.leading ?? NONE}
            onChange={(v) => setModel({ leading: v === NONE ? undefined : v })}
            options={withNone(LEADING, m.leading)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        <FieldRow label="Tracking">
          <MiniSelect
            value={m.tracking ?? NONE}
            onChange={(v) => setModel({ tracking: v === NONE ? undefined : v })}
            options={withNone(TRACKING, m.tracking)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        <FieldRow label="Align">
          <Segmented
            value={m.textAlign}
            onChange={(v) => setModel({ textAlign: v })}
            options={ALIGN}
          />
        </FieldRow>
        <FieldRow label="Color">
          <ColorField
            value={m.textColor ?? ""}
            onChange={(v) => setModel({ textColor: v || undefined })}
            placeholder="foreground"
          />
        </FieldRow>
      </Section>

      <Section title="Appearance">
        <FieldRow label="Background">
          <ColorField
            value={m.bg ?? ""}
            onChange={(v) => setModel({ bg: v || undefined })}
            placeholder="card"
          />
        </FieldRow>
        <FieldRow label="Radius">
          <MiniSelect
            value={m.rounded ?? NONE}
            onChange={(v) => setModel({ rounded: v === NONE ? undefined : v })}
            options={withNone(RADIUS, m.rounded)}
            className="min-w-[6rem]"
          />
        </FieldRow>
        <FieldRow label="Border">
          <MiniSelect
            value={m.borderWidth ?? NONE}
            onChange={(v) => setModel({ borderWidth: v === NONE ? undefined : v })}
            options={withNone(BORDER_W, m.borderWidth)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        {m.borderWidth !== undefined ? (
          <FieldRow label="Border color">
            <ColorField
              value={m.borderColor ?? ""}
              onChange={(v) => setModel({ borderColor: v || undefined })}
              placeholder="border"
            />
          </FieldRow>
        ) : null}
      </Section>

      <Section title="Classes (raw)">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <Chip key={c} label={c} onRemove={() => removeChip(c)} />
          ))}
          {chips.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">no classes</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Plus className="size-3 text-muted-foreground" />
          <AddRow
            placeholder="add class…"
            value={adding}
            onChange={setAdding}
            onSubmit={addClass}
          />
        </div>
      </Section>
    </div>
  );
}
