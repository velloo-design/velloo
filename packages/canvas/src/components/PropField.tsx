import type { PropDescriptor } from "@velloo/shadcn-snapshot";
import { useState } from "react";

interface Props {
  descriptor: PropDescriptor;
  /** Initial value from the design tree. Used to seed local draft state on mount. */
  initialValue: unknown;
  onChange(next: unknown): void;
}

/**
 * Each PropField owns local draft state. The parent passes a `key` tied to
 * selection identity, so switching selections remounts the field with a fresh
 * value. Within one selection, local draft survives store-driven re-renders
 * (hover events, WS refreshes) so the user's in-progress edit never snaps back.
 */
export function PropField({ descriptor, initialValue, onChange }: Props) {
  const [draft, setDraft] = useState<unknown>(initialValue);
  const id = `prop-${descriptor.name}`;

  function commit(next: unknown) {
    setDraft(next);
    onChange(next);
  }

  const label = (
    <label htmlFor={id} className="text-xs font-medium text-[var(--color-fg-muted)] capitalize">
      {descriptor.name}
      {descriptor.optional ? null : <span className="text-red-500"> *</span>}
    </label>
  );

  if (descriptor.control === "boolean") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(draft)}
            onChange={(e) => commit(e.target.checked)}
            className="h-4 w-4 rounded border border-[var(--color-border)]"
          />
          <span className="text-xs text-[var(--color-fg-muted)]">{String(Boolean(draft))}</span>
        </div>
      </div>
    );
  }

  if (descriptor.control === "enum" && descriptor.enumValues) {
    const isNumeric = typeof descriptor.enumValues[0] === "number";
    const current = draft === undefined || draft === null ? "" : String(draft);
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select
          id={id}
          value={current}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") commit(undefined);
            else commit(isNumeric ? Number(raw) : raw);
          }}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
        >
          {descriptor.optional ? <option value="">(unset)</option> : null}
          {descriptor.enumValues.map((v) => (
            <option key={String(v)} value={String(v)}>
              {String(v)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (descriptor.control === "number") {
    const numValue = draft === undefined || draft === null ? "" : Number(draft);
    return (
      <div className="flex flex-col gap-1">
        {label}
        <input
          id={id}
          type="number"
          value={numValue}
          onChange={(e) => commit(e.target.value === "" ? undefined : Number(e.target.value))}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
        />
      </div>
    );
  }

  if (descriptor.control === "color") {
    const current = typeof draft === "string" ? draft : "";
    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            value={current}
            onChange={(e) => commit(e.target.value || undefined)}
            placeholder="oklch(... 0 0) or #rrggbb"
            className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm font-mono"
          />
          <input
            type="color"
            value={current.startsWith("#") ? current : "#000000"}
            onChange={(e) => commit(e.target.value)}
            className="h-8 w-10 rounded border border-[var(--color-border)]"
          />
        </div>
      </div>
    );
  }

  // string fallback
  const current = typeof draft === "string" ? draft : draft === undefined ? "" : String(draft);
  return (
    <div className="flex flex-col gap-1">
      {label}
      <input
        id={id}
        type="text"
        value={current}
        onChange={(e) => commit(e.target.value === "" ? undefined : e.target.value)}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
      />
    </div>
  );
}
