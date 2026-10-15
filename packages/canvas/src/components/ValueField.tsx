import { isNode } from "@velloo/schema";
import { type ReactNode, useState } from "react";
import { IconPicker } from "./IconPicker.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

export type ValueKind = "string" | "number" | "boolean" | "icon" | "color" | "enum" | "node";

const UNSET = "__velloo_unset__";

export interface ValueFieldProps {
  kind: ValueKind;
  /** DOM id for the control (label association). */
  id: string;
  /** Human name — feeds the color picker's aria-label. */
  name: string;
  label: ReactNode;
  labelClassName?: string | undefined;
  /** Wrapper tooltip (snippet params carry a description). */
  title?: string | undefined;
  /**
   * Seeds local draft state on mount. Key the field on selection/param
   * identity so switching targets remounts with a fresh value; within one
   * target the draft survives store-driven re-renders, so an in-progress
   * edit never snaps back.
   */
  initialValue: unknown;
  /** Fires on every edit. The caller owns debounce + endpoint. */
  onCommit(next: unknown): void;
  /** Dense sizing for tight panels (snippet param editor). */
  compact?: boolean | undefined;
  /** string/color: commit `undefined` instead of "" when cleared; number: `undefined` instead of 0. */
  emptyAsUndefined?: boolean | undefined;
  /** enum options; an all-number list commits numbers. */
  enumValues?: ReadonlyArray<string | number> | undefined;
  /** enum: prepend an "(unset)" entry that commits `undefined`. */
  allowUnset?: boolean | undefined;
  /**
   * node: whether only a node may be written (a slot the value fills as a
   * child). Off, it is data handed to a prop, and any JSON is written.
   */
  nodesOnly?: boolean | undefined;
  /** icon: the full icon-name list (see useIconNames). */
  iconNames?: string[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  placeholder?: string | undefined;
}

type NodeDraft = { held: false; value: unknown } | { held: true };

const HELD: NodeDraft = { held: true };

/**
 * What a node field's draft would write. Plain text is text; JSON is written
 * once it parses and, where only a node may go, once it is something a node
 * position holds — a node, a list of nodes and strings, a quoted string, or
 * `null` to clear. Anything else that starts like JSON is held back: a
 * half-typed `{"$ref": …` written as text would replace the component it was
 * editing with its own source.
 */
function readNodeDraft(draft: string, nodesOnly: boolean): NodeDraft {
  const trimmed = draft.trim();
  if (trimmed === "") return { held: false, value: undefined };
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return looksLikeJson ? HELD : { held: false, value: draft };
  }
  if (
    parsed === null ||
    typeof parsed === "string" ||
    (nodesOnly ? isNodeContent(parsed) : typeof parsed === "object")
  ) {
    return { held: false, value: parsed };
  }
  return looksLikeJson ? HELD : { held: false, value: draft };
}

function isNodeContent(v: unknown): boolean {
  return (
    isNode(v) || (Array.isArray(v) && v.every((item) => typeof item === "string" || isNode(item)))
  );
}

/**
 * A string shows as itself whenever reading it back gives the same string —
 * and so, where only a node may go, does the text node a string is saved as.
 */
function nodeDraftText(v: unknown, nodesOnly: boolean): string {
  if (v === undefined || v === null) return "";
  const text = nodesOnly && isBareTextNode(v) ? v.$text : v;
  if (typeof text === "string") {
    const read = readNodeDraft(text, nodesOnly);
    if (!read.held && read.value === text) return text;
  }
  return JSON.stringify(v);
}

function isBareTextNode(v: unknown): v is { $text: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    Object.keys(v).length === 1 &&
    typeof (v as { $text?: unknown }).$text === "string"
  );
}

function toDraftText(kind: ValueKind, v: unknown, nodesOnly: boolean): string {
  if (kind === "node") return nodeDraftText(v, nodesOnly);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/**
 * The one typed value editor behind PropField, snippet-arg fields, and
 * snippet param defaults. Renders the control for `kind` and reports every
 * edit through `onCommit` — commit semantics (debounce, endpoint) stay with
 * the caller.
 */
export function ValueField(props: ValueFieldProps) {
  const { kind, id, compact } = props;
  const nodesOnly = props.nodesOnly ?? true;
  const [text, setText] = useState<string>(() => toDraftText(kind, props.initialValue, nodesOnly));
  const [checked, setChecked] = useState<boolean>(Boolean(props.initialValue));

  // An enum/icon without declared options degrades to a plain text input.
  const effectiveKind: ValueKind =
    (kind === "enum" && !(props.enumValues && props.enumValues.length > 0)) ||
    (kind === "icon" && !props.iconNames)
      ? "string"
      : kind;

  const wrapCls = compact ? "flex flex-col gap-1" : "flex flex-col gap-1.5";
  const label = (
    <Label htmlFor={id} className={props.labelClassName ?? (compact ? "text-[10px]" : "text-xs")}>
      {props.label}
    </Label>
  );

  if (effectiveKind === "boolean") {
    const commit = (c: boolean) => {
      setChecked(c);
      props.onCommit(c);
    };
    return (
      <div className="flex items-center justify-between gap-3" title={props.title}>
        {label}
        <div className="flex items-center gap-2">
          <Checkbox id={id} checked={checked} onCheckedChange={(c) => commit(Boolean(c))} />
          <span
            className={
              compact ? "text-[11px] text-muted-foreground" : "text-xs text-muted-foreground"
            }
          >
            {String(checked)}
          </span>
        </div>
      </div>
    );
  }

  if (effectiveKind === "icon") {
    return (
      <div className={wrapCls} title={props.title}>
        {label}
        <IconPicker
          value={text}
          options={props.iconNames ?? []}
          onChange={(name) => {
            setText(name);
            props.onCommit(name);
          }}
        />
      </div>
    );
  }

  if (effectiveKind === "enum") {
    const enumValues = props.enumValues ?? [];
    const isNumeric = typeof enumValues[0] === "number";
    return (
      <div className={wrapCls} title={props.title}>
        {label}
        <Select
          value={text === "" ? (props.allowUnset ? UNSET : "") : text}
          onValueChange={(raw) => {
            if (raw === UNSET) {
              setText("");
              props.onCommit(undefined);
              return;
            }
            setText(raw);
            props.onCommit(isNumeric ? Number(raw) : raw);
          }}
        >
          <SelectTrigger id={id} size="sm" className={compact ? "text-xs" : "text-sm"}>
            <SelectValue placeholder={props.placeholder ?? "(unset)"} />
          </SelectTrigger>
          <SelectContent>
            {props.allowUnset ? <SelectItem value={UNSET}>(unset)</SelectItem> : null}
            {enumValues.map((v) => (
              <SelectItem key={String(v)} value={String(v)}>
                {String(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (effectiveKind === "number") {
    return (
      <div className={wrapCls} title={props.title}>
        {label}
        <Input
          id={id}
          type="number"
          value={text}
          min={props.min}
          max={props.max}
          step={props.step}
          placeholder={props.placeholder}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value === "" && props.emptyAsUndefined) {
              props.onCommit(undefined);
              return;
            }
            const n = Number(e.target.value);
            if (Number.isFinite(n)) props.onCommit(n);
          }}
          className={compact ? "h-7 text-xs" : undefined}
        />
      </div>
    );
  }

  if (effectiveKind === "color") {
    const commit = (v: string) => {
      setText(v);
      props.onCommit(props.emptyAsUndefined && v === "" ? undefined : v);
    };
    return (
      <div className={wrapCls} title={props.title}>
        {label}
        <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
          <input
            type="color"
            aria-label={`${props.name} color picker`}
            value={text.startsWith("#") ? text : "#000000"}
            onChange={(e) => commit(e.target.value)}
            className="h-7 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent"
          />
          <Input
            id={id}
            type="text"
            value={text}
            placeholder={props.placeholder}
            onChange={(e) => commit(e.target.value)}
            className={compact ? "h-7 flex-1 font-mono text-xs" : "flex-1 font-mono"}
          />
        </div>
      </div>
    );
  }

  if (effectiveKind === "node") {
    const held = readNodeDraft(text, nodesOnly).held;
    return (
      <div className={wrapCls} title={props.title}>
        {label}
        <Input
          id={id}
          value={text}
          aria-invalid={held || undefined}
          aria-describedby={held ? `${id}-held` : undefined}
          placeholder={
            props.placeholder ?? (nodesOnly ? 'Text, or a node: {"$ref":"Card"}' : "Text, or JSON")
          }
          onChange={(e) => {
            setText(e.target.value);
            const read = readNodeDraft(e.target.value, nodesOnly);
            if (!read.held) props.onCommit(read.value);
          }}
          className="h-7 font-mono text-[10px]"
        />
        {held ? (
          <p id={`${id}-held`} className="text-[10px] text-muted-foreground">
            {nodesOnly
              ? "Not saved — not a node yet. Write a node, a list, a quoted string, or plain text."
              : "Not saved — not JSON yet."}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={wrapCls} title={props.title}>
      {label}
      <Input
        id={id}
        type="text"
        value={text}
        placeholder={props.placeholder}
        onChange={(e) => {
          setText(e.target.value);
          props.onCommit(
            props.emptyAsUndefined && e.target.value === "" ? undefined : e.target.value,
          );
        }}
        className={compact ? "h-7 text-xs" : undefined}
      />
    </div>
  );
}
