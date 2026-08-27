import { ArrowDown, ArrowLeftRight, ArrowRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { mutate } from "../../api.ts";
import { useDebouncedCommit } from "../../hooks/useDebouncedCommit.ts";
import { pathFromString } from "../../path.ts";
import {
  type CssVal,
  cssToPx,
  type ParsedStyle,
  parseStyle,
  type StyleModel,
  serializeStyle,
} from "../../style-editor/style-object.ts";
import {
  BoxModel,
  ColorField,
  FieldRow,
  MiniSelect,
  NONE,
  NumberField,
  Section,
  Segmented,
  type Side,
  withNone,
} from "./controls.tsx";

interface Props {
  initialValue: Record<string, unknown> | undefined;
  prop: string;
  screenId: string;
  path: string;
  debounceMs: number;
}

const DISPLAY: Array<[string, string?]> = [
  ["flex"],
  ["block"],
  ["grid"],
  ["inline-flex"],
  ["none"],
];
const DIRECTION = [
  { value: "row", icon: <ArrowRight className="size-3.5" />, title: "row" },
  { value: "column", icon: <ArrowDown className="size-3.5" />, title: "column" },
];
const JUSTIFY: Array<[string, string?]> = [
  ["flex-start", "start"],
  ["center"],
  ["flex-end", "end"],
  ["space-between", "between"],
  ["space-around", "around"],
];
const ALIGN: Array<[string, string?]> = [
  ["flex-start", "start"],
  ["center"],
  ["flex-end", "end"],
  ["stretch"],
];
const WEIGHT: Array<[string, string?]> = [["400"], ["500"], ["600"], ["700"], ["300"]];
const TEXT_ALIGN = [
  { value: "left", label: "L" },
  { value: "center", label: "C" },
  { value: "right", label: "R" },
  { value: "justify", label: "J" },
];
const UNITS = ["px", "rem", "em", "%", "vh", "vw", "—"];

const str = (v: CssVal | undefined) => (v === undefined ? "" : String(v));

/** Split a CSS value into a numeric part + unit for the unit-aware field. */
function splitUnit(v: CssVal | undefined): { num: string; unit: string } {
  if (v === undefined) return { num: "", unit: "px" };
  if (typeof v === "number") return { num: String(v), unit: "px" };
  const m = /^(-?\d*\.?\d+)(px|rem|em|%|vh|vw)?$/.exec(v.trim());
  if (m) return { num: m[1] ?? "", unit: m[2] ?? "—" };
  return { num: v, unit: "—" };
}
function joinUnit(num: string, unit: string): CssVal | undefined {
  const t = num.trim();
  if (!t) return undefined;
  const numeric = /^-?\d*\.?\d+$/.test(t);
  if (unit === "px") return numeric ? Number(t) : `${t}px`;
  if (unit === "—") return numeric ? Number(t) : t;
  return `${t}${unit}`;
}

/** Parse a declaration-row input back into a value (number, JSON, or string). */
function parseDecl(raw: string): unknown {
  const t = raw.trim();
  if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
  try {
    const j = JSON.parse(t);
    if (typeof j === "object" && j !== null) return j;
  } catch {
    /* keep raw string */
  }
  return raw;
}

export function StyleObjectEditor({ initialValue, prop, screenId, path, debounceMs }: Props) {
  const [parsed, setParsed] = useState<ParsedStyle>(() => parseStyle(initialValue));
  const [adding, setAdding] = useState("");

  const push = useDebouncedCommit<ParsedStyle>(debounceMs, (next) => {
    const obj = serializeStyle(next);
    void mutate
      .updateProps({
        screenId,
        path: pathFromString(path),
        propPatch: { [prop]: Object.keys(obj).length ? obj : null },
      })
      .catch(() => undefined);
  });
  const commit = (next: ParsedStyle) => {
    setParsed(next);
    push(next);
  };

  const m = parsed.model;
  const setModel = (patch: Partial<StyleModel>) => commit({ ...parsed, model: { ...m, ...patch } });
  const sideSet = (s: string): CssVal | undefined => {
    const t = s.trim();
    if (!t) return undefined;
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  };
  const setSide = (box: "padding" | "margin", side: Side, value: string) =>
    setModel({ [box]: { ...m[box], [side]: sideSet(value) } } as Partial<StyleModel>);
  const sideShow = (v: CssVal | undefined) => {
    const px = cssToPx(v);
    return px !== null ? String(px) : str(v);
  };
  const sides = (s: StyleModel["padding"]) => ({
    top: sideShow(s.top),
    right: sideShow(s.right),
    bottom: sideShow(s.bottom),
    left: sideShow(s.left),
  });

  // Unit-aware field bound to a model key.
  const unitField = (key: "gap" | "fontSize" | "lineHeight" | "borderRadius") => {
    const { num, unit } = splitUnit(m[key]);
    return (
      <NumberField
        value={num}
        unit={unit}
        units={UNITS}
        onChange={(v) => setModel({ [key]: joinUnit(v, unit) } as Partial<StyleModel>)}
        onUnitChange={(u) => setModel({ [key]: joinUnit(num, u) } as Partial<StyleModel>)}
        className="w-28"
      />
    );
  };

  const decls = Object.entries(serializeStyle(parsed));
  const setDecl = (key: string, raw: string) =>
    commit(parseStyle({ ...serializeStyle(parsed), [key]: parseDecl(raw) }));
  const removeDecl = (key: string) => {
    const { [key]: _drop, ...rest } = serializeStyle(parsed);
    void _drop;
    commit(parseStyle(rest));
  };
  const addDecl = () => {
    const k = adding.trim();
    if (!k || k in serializeStyle(parsed)) return;
    commit(parseStyle({ ...serializeStyle(parsed), [k]: "" }));
    setAdding("");
  };

  return (
    <div className="-mx-4 -mb-4 flex flex-col">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-2">
        <ArrowLeftRight className="size-3.5 text-primary" />
        <span className="text-[11px] text-foreground">
          Controls ⇄ declarations — edit either side
        </span>
      </div>

      <Section title="Box model">
        <BoxModel
          contentLabel="content"
          padding={sides(m.padding)}
          margin={sides(m.margin)}
          onPadding={(s, v) => setSide("padding", s, v)}
          onMargin={(s, v) => setSide("margin", s, v)}
        />
      </Section>

      <Section title="Layout">
        <FieldRow label="display">
          <MiniSelect
            value={str(m.display) || NONE}
            onChange={(v) => setModel({ display: v === NONE ? undefined : v })}
            options={withNone(DISPLAY, m.display)}
          />
        </FieldRow>
        <FieldRow label="flexDirection">
          <Segmented
            value={str(m.flexDirection) || undefined}
            onChange={(v) => setModel({ flexDirection: v })}
            options={DIRECTION}
          />
        </FieldRow>
        <FieldRow label="justify">
          <MiniSelect
            value={str(m.justifyContent) || NONE}
            onChange={(v) => setModel({ justifyContent: v === NONE ? undefined : v })}
            options={withNone(JUSTIFY, m.justifyContent)}
          />
        </FieldRow>
        <FieldRow label="alignItems">
          <MiniSelect
            value={str(m.alignItems) || NONE}
            onChange={(v) => setModel({ alignItems: v === NONE ? undefined : v })}
            options={withNone(ALIGN, m.alignItems)}
          />
        </FieldRow>
        <FieldRow label="gap">{unitField("gap")}</FieldRow>
      </Section>

      <Section title="Typography">
        <FieldRow label="fontSize">{unitField("fontSize")}</FieldRow>
        <FieldRow label="lineHeight">{unitField("lineHeight")}</FieldRow>
        <FieldRow label="fontWeight">
          <MiniSelect
            value={str(m.fontWeight) || NONE}
            onChange={(v) => setModel({ fontWeight: v === NONE ? undefined : v })}
            options={withNone(WEIGHT, m.fontWeight)}
            className="min-w-[5rem]"
          />
        </FieldRow>
        <FieldRow label="textAlign">
          <Segmented
            value={str(m.textAlign) || undefined}
            onChange={(v) => setModel({ textAlign: v })}
            options={TEXT_ALIGN}
          />
        </FieldRow>
        <FieldRow label="color">
          <ColorField
            value={str(m.color)}
            onChange={(v) => setModel({ color: v || undefined })}
            placeholder="var(--foreground)"
          />
        </FieldRow>
      </Section>

      <Section title="Appearance">
        <FieldRow label="background">
          <ColorField
            value={str(m.backgroundColor)}
            onChange={(v) => setModel({ backgroundColor: v || undefined })}
            placeholder="var(--card)"
          />
        </FieldRow>
        <FieldRow label="radius">{unitField("borderRadius")}</FieldRow>
      </Section>

      <Section title="Declarations (raw, synced)">
        {decls.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
              {k}
            </span>
            <input
              value={
                typeof v === "string" ? v : typeof v === "number" ? String(v) : JSON.stringify(v)
              }
              spellCheck={false}
              onChange={(e) => setDecl(k, e.target.value)}
              className="min-w-0 flex-1 h-6 rounded border border-input bg-background px-1.5 font-mono text-[11px] outline-none"
            />
            <button
              type="button"
              onClick={() => removeDecl(k)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`remove ${k}`}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {decls.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">no styles</span>
        ) : null}
        <div className="flex items-center gap-1.5">
          <Plus className="size-3 text-muted-foreground" />
          <NumberField
            value={adding}
            onChange={setAdding}
            className="w-full"
            placeholder="property…"
          />
          <button
            type="button"
            onClick={addDecl}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            add
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          A bare number is px (gap: 16); other units → a string ('0.875rem', '50vh'). Unitless props
          stay numbers (lineHeight: 1.5).
        </p>
      </Section>
    </div>
  );
}
