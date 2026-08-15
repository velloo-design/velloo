import type { PropDescriptor } from "@velloo/shadcn-snapshot";
import { useState } from "react";
import { IconPicker } from "./IconPicker.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

interface Props {
  descriptor: PropDescriptor;
  /** Initial value from the design tree. Used to seed local draft state on mount. */
  initialValue: unknown;
  onChange(next: unknown): void;
}

/**
 * Each PropField owns local draft state. The parent passes a `key` tied
 * to selection identity, so switching selections remounts the field
 * with a fresh value. Within one selection, local draft survives
 * store-driven re-renders (hover events, WS refreshes) so the user's
 * in-progress edit never snaps back.
 */
export function PropField({ descriptor, initialValue, onChange }: Props) {
  const [draft, setDraft] = useState<unknown>(initialValue);
  const id = `prop-${descriptor.name}`;

  function commit(next: unknown) {
    setDraft(next);
    onChange(next);
  }

  const label = (
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground capitalize">
      {descriptor.name}
      {descriptor.optional ? null : <span className="text-destructive"> *</span>}
    </Label>
  );

  if (descriptor.control === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(draft)}
            onCheckedChange={(checked) => commit(Boolean(checked))}
          />
          <span className="text-xs text-muted-foreground">{String(Boolean(draft))}</span>
        </div>
      </div>
    );
  }

  if (descriptor.control === "icon" && descriptor.enumValues) {
    const current = typeof draft === "string" ? draft : "";
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <IconPicker
          value={current}
          options={descriptor.enumValues as string[]}
          onChange={(name) => commit(name)}
        />
      </div>
    );
  }

  if (descriptor.control === "enum" && descriptor.enumValues) {
    const isNumeric = typeof descriptor.enumValues[0] === "number";
    const current = draft === undefined || draft === null ? "" : String(draft);
    const UNSET = "__velloo_unset__";
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Select
          value={current === "" ? UNSET : current}
          onValueChange={(raw) => {
            if (raw === UNSET) commit(undefined);
            else commit(isNumeric ? Number(raw) : raw);
          }}
        >
          <SelectTrigger id={id} size="sm" className="text-sm">
            <SelectValue placeholder="(unset)" />
          </SelectTrigger>
          <SelectContent>
            {descriptor.optional ? <SelectItem value={UNSET}>(unset)</SelectItem> : null}
            {descriptor.enumValues.map((v) => (
              <SelectItem key={String(v)} value={String(v)}>
                {String(v)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (descriptor.control === "number") {
    const numValue = draft === undefined || draft === null ? "" : String(Number(draft));
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Input
          id={id}
          type="number"
          value={numValue}
          onChange={(e) => commit(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </div>
    );
  }

  if (descriptor.control === "color") {
    const current = typeof draft === "string" ? draft : "";
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <div className="flex gap-2">
          <Input
            id={id}
            type="text"
            value={current}
            onChange={(e) => commit(e.target.value || undefined)}
            placeholder="oklch(... 0 0) or #rrggbb"
            className="flex-1 font-mono"
          />
          <input
            type="color"
            aria-label={`${descriptor.name} color picker`}
            value={current.startsWith("#") ? current : "#000000"}
            onChange={(e) => commit(e.target.value)}
            className="h-8 w-10 rounded border border-input bg-transparent"
          />
        </div>
      </div>
    );
  }

  const current = typeof draft === "string" ? draft : draft === undefined ? "" : String(draft);
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <Input
        id={id}
        type="text"
        value={current}
        onChange={(e) => commit(e.target.value === "" ? undefined : e.target.value)}
      />
    </div>
  );
}
