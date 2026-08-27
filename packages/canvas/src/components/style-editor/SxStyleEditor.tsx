import { ArrowDown, ArrowRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { mutate } from "../../api.ts";
import { useDebouncedCommit } from "../../hooks/useDebouncedCommit.ts";
import { pathFromString } from "../../path.ts";
import {
  type ParsedSx,
  parseSx,
  pxToSx,
  type SxModel,
  type SxVal,
  serializeSx,
  sxToPx,
} from "../../style-editor/sx-object.ts";
import {
  AddRow,
  BoxModel,
  CodeBlock,
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
  ["space-evenly", "evenly"],
];
const ALIGN_ITEMS: Array<[string, string?]> = [
  ["flex-start", "start"],
  ["center"],
  ["flex-end", "end"],
  ["stretch"],
  ["baseline"],
];
const WEIGHT: Array<[string, string?]> = [
  ["normal"],
  ["medium"],
  ["semibold"],
  ["bold"],
  ["light"],
];
const TEXT_ALIGN = [
  { value: "left", label: "L" },
  { value: "center", label: "C" },
  { value: "right", label: "R" },
  { value: "justify", label: "J" },
];

const str = (v: SxVal | undefined) => (v === undefined ? "" : String(v));
function toVal(s: string): SxVal | undefined {
  const t = s.trim();
  if (!t) return undefined;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
}
function spInput(v: SxVal | undefined): string {
  const px = sxToPx(v);
  return px !== null ? String(px) : str(v);
}
function spSet(s: string): SxVal | undefined {
  const t = s.trim();
  if (!t) return undefined;
  return /^-?\d+(\.\d+)?$/.test(t) ? pxToSx(Number(t)) : t;
}

export function SxStyleEditor({ initialValue, prop, screenId, path, debounceMs }: Props) {
  const [parsed, setParsed] = useState<ParsedSx>(() => parseSx(initialValue));
  const [adding, setAdding] = useState("");

  const push = useDebouncedCommit<ParsedSx>(debounceMs, (next) => {
    const obj = serializeSx(next);
    void mutate
      .updateProps({
        screenId,
        path: pathFromString(path),
        propPatch: { [prop]: Object.keys(obj).length ? obj : null },
      })
      .catch(() => undefined);
  });
  const commit = (next: ParsedSx) => {
    setParsed(next);
    push(next);
  };

  const m = parsed.model;
  const setModel = (patch: Partial<SxModel>) => commit({ ...parsed, model: { ...m, ...patch } });
  const setSide = (box: "padding" | "margin", side: Side, value: string) =>
    setModel({ [box]: { ...m[box], [side]: spSet(value) } } as Partial<SxModel>);
  const sides = (s: SxModel["padding"]) => ({
    top: spInput(s.top),
    right: spInput(s.right),
    bottom: spInput(s.bottom),
    left: spInput(s.left),
  });

  const extraEntries = Object.entries(parsed.extra);
  const setExtra = (key: string, raw: string) => {
    let value: unknown = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      /* keep as string */
    }
    commit({ ...parsed, extra: { ...parsed.extra, [key]: value } });
  };
  const removeExtra = (key: string) => {
    const { [key]: _drop, ...rest } = parsed.extra;
    void _drop;
    commit({ ...parsed, extra: rest });
  };
  const addExtra = () => {
    const k = adding.trim();
    if (!k || k in parsed.extra) return;
    commit({ ...parsed, extra: { ...parsed.extra, [k]: "" } });
    setAdding("");
  };

  const preview = JSON.stringify(serializeSx(parsed), null, 2);

  return (
    <div className="-mx-4 -mb-4 flex flex-col">
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
            options={withNone(ALIGN_ITEMS, m.alignItems)}
          />
        </FieldRow>
        <FieldRow label="gap">
          <NumberField
            value={spInput(m.gap)}
            onChange={(v) => setModel({ gap: spSet(v) })}
            unit="px"
          />
        </FieldRow>
      </Section>

      <Section title="Spacing · theme.spacing ×8">
        <BoxModel
          contentLabel="content"
          padding={sides(m.padding)}
          margin={sides(m.margin)}
          onPadding={(s, v) => setSide("padding", s, v)}
          onMargin={(s, v) => setSide("margin", s, v)}
        />
        <p className="text-[10px] text-muted-foreground">
          number → theme.spacing(n): 2 = 16px; off-grid → a px string.
        </p>
      </Section>

      <Section title="Typography">
        <FieldRow label="typography">
          <MiniSelect
            value={str(m.typography) || NONE}
            onChange={(v) => setModel({ typography: v === NONE ? undefined : v })}
            options={withNone(
              [["body1"], ["body2"], ["subtitle1"], ["subtitle2"], ["h6"], ["caption"]],
              m.typography,
            )}
            className="min-w-[6rem]"
          />
        </FieldRow>
        <FieldRow label="fontSize">
          <NumberField
            value={str(m.fontSize)}
            onChange={(v) => setModel({ fontSize: toVal(v) })}
            placeholder="14"
          />
        </FieldRow>
        <FieldRow label="fontWeight">
          <MiniSelect
            value={str(m.fontWeight) || NONE}
            onChange={(v) => setModel({ fontWeight: v === NONE ? undefined : v })}
            options={withNone(WEIGHT, m.fontWeight)}
            className="min-w-[6rem]"
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
            placeholder="text.primary"
          />
        </FieldRow>
      </Section>

      <Section title="Appearance">
        <FieldRow label="bgcolor">
          <ColorField
            value={str(m.bgcolor)}
            onChange={(v) => setModel({ bgcolor: v || undefined })}
            placeholder="background.paper"
          />
        </FieldRow>
        <FieldRow label="boxShadow">
          <NumberField
            value={str(m.boxShadow)}
            onChange={(v) => setModel({ boxShadow: toVal(v) })}
            unit="elev"
          />
        </FieldRow>
        <FieldRow label="borderRadius">
          <NumberField
            value={str(m.borderRadius)}
            onChange={(v) => setModel({ borderRadius: toVal(v) })}
          />
        </FieldRow>
      </Section>

      <Section title="Additional sx (raw)">
        <p className="text-[10px] text-muted-foreground">
          props the controls don't cover — pseudo-selectors, transitions, one-offs
        </p>
        {extraEntries.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
              {k}
            </span>
            <input
              defaultValue={typeof v === "string" ? v : JSON.stringify(v)}
              spellCheck={false}
              onChange={(e) => setExtra(k, e.target.value)}
              className="min-w-0 flex-1 h-6 rounded border border-input bg-background px-1.5 font-mono text-[11px] outline-none"
            />
            <button
              type="button"
              onClick={() => removeExtra(k)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`remove ${k}`}
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <Plus className="size-3 text-muted-foreground" />
          <AddRow placeholder="property…" value={adding} onChange={setAdding} onSubmit={addExtra} />
        </div>
      </Section>

      <Section title="sx (merged)" defaultOpen={false}>
        <CodeBlock code={preview} />
      </Section>
    </div>
  );
}
