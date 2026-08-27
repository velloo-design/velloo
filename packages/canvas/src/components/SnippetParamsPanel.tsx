import type { Snippet, SnippetParam } from "@velloo/schema";
import { Pencil, Save, X } from "lucide-react";
import { useState } from "react";
import { useIconNames } from "../hooks/useIconNames.ts";
import { pushToast } from "../toast.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { ValueField, type ValueKind } from "./ValueField.tsx";

interface SnippetParamsPanelProps {
  snippet: Snippet;
  onPatchParams: (params: SnippetParam[]) => void;
}

/**
 * The params-editing rail of the snippet editor: list, add, remove, and the
 * inline per-param editor (name/type/required/default/enum values). Extracted
 * from SnippetView so the view stays focused on preview + selection plumbing.
 */
export function SnippetParamsPanel({ snippet, onPatchParams }: SnippetParamsPanelProps) {
  const [editingParam, setEditingParam] = useState<number | null>(null);
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);
  const iconNames = useIconNames();

  const updateParam = (index: number, next: SnippetParam) => {
    const list = [...snippet.params];
    list[index] = next;
    onPatchParams(list);
  };

  const confirmRemove = () => {
    if (pendingRemove === null) return;
    onPatchParams(snippet.params.filter((_, i) => i !== pendingRemove));
    setPendingRemove(null);
  };

  const addParam = () => {
    const existing = new Set(snippet.params.map((p) => p.name));
    let name = "param";
    let i = 1;
    while (existing.has(name)) name = `param${++i}`;
    onPatchParams([...snippet.params, { name, type: "string" }]);
    pushToast({ kind: "success", message: `Added param "${name}"` });
  };

  return (
    <section className="border-b flex flex-col gap-1 px-3 pt-3 pb-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Params
        </div>
        <Button variant="ghost" size="xs" onClick={addParam} className="h-6 text-xs px-1.5">
          + add
        </Button>
      </div>
      {snippet.params.length === 0 ? (
        <div className="text-[11px] text-muted-foreground leading-relaxed mt-1">
          No params yet. Add one above, then reference it in the body as{" "}
          <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">
            {"{$param:name}"}
          </code>
          .
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {snippet.params.map((p, i) => (
            <li key={p.name} className="rounded-md border bg-background">
              {editingParam === i ? (
                <ParamEditor
                  initial={p}
                  iconNames={iconNames}
                  onSave={(next) => {
                    setEditingParam(null);
                    updateParam(i, next);
                  }}
                  onCancel={() => setEditingParam(null)}
                />
              ) : (
                <ParamRow
                  param={p}
                  onEdit={() => setEditingParam(i)}
                  onRemove={() => setPendingRemove(i)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove parameter</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove !== null
                ? `Remove parameter "${snippet.params[pendingRemove]?.name}"? Existing instances will lose this arg.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function ParamRow({
  param,
  onEdit,
  onRemove,
}: {
  param: SnippetParam;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const summary = formatDefaultSummary(param);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="font-mono text-[11px] truncate">{param.name}</span>
        <Badge variant="outline" className="text-[9px] font-mono shrink-0">
          {param.type}
        </Badge>
        {summary ? (
          <span className="text-[10px] text-muted-foreground truncate">{summary}</span>
        ) : (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">required</span>
        )}
      </div>
      <Button variant="ghost" size="xs" onClick={onEdit} className="h-5 px-1">
        <Pencil size={10} />
      </Button>
      <Button
        variant="ghost"
        size="xs"
        onClick={onRemove}
        className="h-5 px-1 text-destructive hover:bg-destructive/10"
      >
        <X size={10} />
      </Button>
    </div>
  );
}

function formatDefaultSummary(param: SnippetParam): string | null {
  if (param.default === undefined) return null;
  if (typeof param.default === "string") return `= "${param.default}"`;
  if (typeof param.default === "number" || typeof param.default === "boolean")
    return `= ${param.default}`;
  return "= …";
}

function ParamEditor({
  initial,
  iconNames,
  onSave,
  onCancel,
}: {
  initial: SnippetParam;
  iconNames: string[];
  onSave: (next: SnippetParam) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SnippetParam>(initial);
  const required = draft.default === undefined;
  const types: SnippetParam["type"][] = [
    "string",
    "number",
    "boolean",
    "node",
    "icon",
    "color",
    "enum",
  ];

  const setRequired = (req: boolean) => {
    if (req) {
      const { default: _omit, ...rest } = draft;
      void _omit;
      setDraft(rest);
    } else {
      // Re-add a default appropriate for the type.
      setDraft({ ...draft, default: defaultValueForType(draft.type, draft.enum) });
    }
  };

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-7 font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px]">type</Label>
          <Select
            value={draft.type}
            onValueChange={(v) => {
              const nextType = v as SnippetParam["type"];
              // Reset default to a sensible value for the new type so
              // the user doesn't end up with e.g. number default after
              // switching to "icon".
              const next: SnippetParam = { ...draft, type: nextType };
              if (next.default !== undefined) {
                next.default = defaultValueForType(nextType, next.enum);
              }
              setDraft(next);
            }}
          >
            <SelectTrigger size="sm" className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {draft.type === "enum" ? (
        <EnumValuesField
          value={draft.enum ?? []}
          onChange={(enumValues) => setDraft({ ...draft, enum: enumValues })}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <Checkbox
          id="param-required"
          checked={required}
          onCheckedChange={(c) => setRequired(Boolean(c))}
        />
        <Label htmlFor="param-required" className="text-[11px]">
          Required (no default — instances must supply a value)
        </Label>
      </div>

      {!required ? (
        <DefaultField
          param={draft}
          iconNames={iconNames}
          onChange={(value) => setDraft({ ...draft, default: value })}
        />
      ) : null}

      <div className="flex gap-1.5 justify-end">
        <Button variant="ghost" size="xs" onClick={onCancel} className="h-6 text-xs">
          Cancel
        </Button>
        <Button size="xs" onClick={() => onSave(draft)} className="h-6 text-xs">
          <Save size={11} /> Save
        </Button>
      </div>
    </div>
  );
}

function defaultValueForType(type: SnippetParam["type"], enumValues?: string[]): unknown {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "icon":
      return "Sparkles";
    case "color":
      return "#7c3aed";
    case "enum":
      return enumValues?.[0] ?? "";
    case "node":
      return { $ref: "Text", props: { children: "node default" } };
    default:
      return null;
  }
}

function DefaultField({
  param,
  iconNames,
  onChange,
}: {
  param: SnippetParam;
  iconNames: string[];
  onChange: (value: unknown) => void;
}) {
  const kind: ValueKind = param.type === "enum" && !param.enum?.length ? "string" : param.type;
  const label =
    param.type === "icon"
      ? "default icon"
      : param.type === "color"
        ? "default color"
        : param.type === "node"
          ? "default (JSON node)"
          : "default";
  const initialValue =
    param.type === "icon"
      ? typeof param.default === "string"
        ? param.default
        : "Sparkles"
      : param.type === "color"
        ? typeof param.default === "string"
          ? param.default
          : "#7c3aed"
        : param.default;
  return (
    <ValueField
      // ValueField seeds its draft on mount; remount when the type flips so
      // the field re-reads the freshly reset default.
      key={param.type}
      kind={kind}
      id={`param-default-${param.name}`}
      name={`${param.name} default`}
      label={label}
      compact
      initialValue={initialValue}
      onCommit={onChange}
      enumValues={param.enum}
      iconNames={iconNames}
      placeholder={
        param.type === "string" ? "default text" : param.type === "enum" ? "(pick one)" : undefined
      }
    />
  );
}

function EnumValuesField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px]">enum (comma-separated)</Label>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = draft
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          onChange(parsed);
        }}
        className="h-7 font-mono text-xs"
        placeholder="solid, ghost, outline"
      />
    </div>
  );
}
