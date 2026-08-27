import { ChevronDown, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

/** The em-dash "unset" sentinel shared by every style-editor MiniSelect. */
export const NONE = "—";

/** Build a MiniSelect option list with a leading "unset" entry, and inject the
 *  current value if it isn't already one of the presets (so arbitrary values
 *  aren't silently dropped on the next edit). */
export function withNone(
  opts: Array<[string, string?]>,
  current: string | number | undefined,
): Array<[string, string?]> {
  const cur = current === undefined ? undefined : String(current);
  const all = [[NONE, NONE] as [string, string?], ...opts];
  if (cur !== undefined && !opts.some(([v]) => v === cur)) all.push([cur, cur]);
  return all;
}

/** A collapsible inspector section: uppercase label + chevron, then a body. */
export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {title}
        <ChevronDown className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open ? <div className="px-3 pb-3 flex flex-col gap-2.5">{children}</div> : null}
    </section>
  );
}

/** Label on the left, control on the right. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-7">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      {children}
    </div>
  );
}

export interface SegOption {
  value: string;
  label?: string;
  icon?: ReactNode;
  title?: string;
}

/** Segmented single-select (display, direction, text-align …). Empty string from
 *  the underlying ToggleGroup (deselect) surfaces as `undefined`. */
export function Segmented({
  value,
  onChange,
  options,
  className,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: SegOption[];
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value ?? ""}
      onValueChange={(v) => onChange(v || undefined)}
      className={className}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          title={o.title ?? o.label ?? o.value}
          className="h-7 min-w-7 px-2 text-[11px]"
        >
          {o.icon ?? o.label ?? o.value}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** A number/text field with an optional unit suffix or unit dropdown. */
export function NumberField({
  value,
  onChange,
  unit,
  units,
  onUnitChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Static suffix (e.g. "px") shown when there's no unit dropdown. */
  unit?: string;
  /** When provided, render a unit `<select>` instead of a static suffix. */
  units?: string[];
  onUnitChange?: (u: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center h-7 rounded-md border border-input bg-background overflow-hidden ${className ?? "w-20"}`}
    >
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-2 text-xs tabular-nums outline-none"
      />
      {units && onUnitChange ? (
        <select
          value={unit ?? units[0]}
          onChange={(e) => onUnitChange(e.target.value)}
          className="self-stretch border-l border-input bg-muted/50 px-1 text-[10px] text-muted-foreground outline-none"
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      ) : unit ? (
        <span className="self-stretch flex items-center border-l border-input px-1.5 text-[10px] text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

/** A native select styled to match. options: [value, label?]. */
export function MiniSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string?]>;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none ${className ?? "min-w-[7rem]"}`}
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label ?? v}
        </option>
      ))}
    </select>
  );
}

/** Is the value an arbitrary CSS color we can preview inline (#hex, rgb/hsl, var(...))? */
function previewColor(value: string): string | null {
  const inner = /^\[(.+)\]$/.exec(value)?.[1] ?? value;
  if (/^#([0-9a-f]{3,8})$/i.test(inner)) return inner;
  if (/^(rgb|hsl|oklch|var)\(/i.test(inner)) return inner;
  return null;
}

/** A color swatch + editable token field. The swatch previews arbitrary colors
 *  (hex/rgb/var) inline; token names (`card`, `red-500`) show a neutral chip
 *  since their resolved color lives in the design folder's theme, not here. */
export function ColorField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const preview = previewColor(value);
  return (
    <div className="inline-flex min-w-0 items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-md border border-input bg-background">
      <span
        className="size-4 shrink-0 rounded-[3px] border border-border bg-[repeating-conic-gradient(#0000_0deg_90deg,#8884_90deg_180deg)]"
        style={preview ? { background: preview } : undefined}
      />
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xs outline-none"
      />
    </div>
  );
}

/** A removable token/class chip. */
export function Chip({
  label,
  swatch,
  onRemove,
}: {
  label: string;
  swatch?: string | null;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded bg-secondary text-secondary-foreground text-[11px] font-mono">
      {swatch ? (
        <span
          className="size-3 rounded-[2px] border border-border"
          style={{ background: swatch }}
        />
      ) : null}
      <span className="truncate max-w-[14rem]">{label}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-foreground"
          aria-label={`remove ${label}`}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** A read-only code preview block. */
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="rounded-md border bg-muted/50 p-2.5 font-mono text-[10.5px] leading-[1.6] text-muted-foreground whitespace-pre-wrap break-words">
      {code}
    </pre>
  );
}

export type Side = "top" | "right" | "bottom" | "left";

/** The DevTools-style box-model widget: a margin band wrapping a padding band
 *  wrapping the content. Each side is an editable field reported as a raw string
 *  — the caller maps to/from its channel's value form. */
export function BoxModel({
  padding,
  margin,
  contentLabel,
  onPadding,
  onMargin,
}: {
  padding: Record<Side, string>;
  margin: Record<Side, string>;
  contentLabel: string;
  onPadding: (side: Side, value: string) => void;
  onMargin: (side: Side, value: string) => void;
}) {
  const sideInput = (val: string, on: (v: string) => void, key: string) => (
    <input
      key={key}
      value={val}
      spellCheck={false}
      onChange={(e) => on(e.target.value)}
      className="w-9 rounded border border-transparent bg-transparent text-center text-[10px] tabular-nums text-foreground outline-none focus:border-ring hover:bg-background/60"
    />
  );
  return (
    <div className="relative rounded-md border border-dashed bg-muted/40 px-2 pb-1 pt-4 text-muted-foreground">
      <span className="absolute left-2 top-1 text-[8px] font-medium uppercase tracking-wide text-muted-foreground/80">
        margin
      </span>
      <div className="flex justify-center">
        {sideInput(margin.top, (v) => onMargin("top", v), "mt")}
      </div>
      <div className="flex items-center gap-1">
        {sideInput(margin.left, (v) => onMargin("left", v), "ml")}
        <div className="relative flex-1 rounded border bg-accent/40 px-2 pb-1 pt-4">
          <span className="absolute left-1.5 top-0.5 text-[8px] font-medium uppercase tracking-wide text-muted-foreground/80">
            padding
          </span>
          <div className="flex justify-center">
            {sideInput(padding.top, (v) => onPadding("top", v), "pt")}
          </div>
          <div className="flex items-center gap-1">
            {sideInput(padding.left, (v) => onPadding("left", v), "pl")}
            <div className="flex h-9 flex-1 items-center justify-center rounded border bg-background text-[10px] text-muted-foreground">
              {contentLabel}
            </div>
            {sideInput(padding.right, (v) => onPadding("right", v), "pr")}
          </div>
          <div className="flex justify-center">
            {sideInput(padding.bottom, (v) => onPadding("bottom", v), "pb")}
          </div>
        </div>
        {sideInput(margin.right, (v) => onMargin("right", v), "mr")}
      </div>
      <div className="flex justify-center">
        {sideInput(margin.bottom, (v) => onMargin("bottom", v), "mb")}
      </div>
    </div>
  );
}

/** Dashed "+ add …" affordance (raw chip / declaration input launcher). */
export function AddRow({
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit();
      }}
      className="h-7 w-full rounded-md border border-dashed border-input bg-background px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
    />
  );
}
