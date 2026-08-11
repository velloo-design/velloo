import { useEffect, useRef, useState } from "react";
import { theme as themeApi } from "../api.ts";
import { normalizeToOklch, parseTriplet } from "../color.ts";

interface Props {
  label: string;
  tokenPath: string;
  value: string;
}

const DEBOUNCE_MS = 250;

/**
 * Click the swatch to open a small color editor with a native picker plus
 * synced HEX / OKLCH / HSL fields. Everything is converted via culori; we
 * always store OKLCH on disk so the theme JSON stays in one canonical form.
 */
export function ColorSwatch({ label, tokenPath, value }: Props) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reflect external updates (preset switch, vibe match, WS refresh).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const commit = (next: string) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Normalize to OKLCH for storage; fall back to the user's literal input
      // if culori can't parse (the server schema will reject if truly bad).
      const oklch = normalizeToOklch(next);
      const valueToSend = oklch ?? next;
      void themeApi.setToken(tokenPath, valueToSend).catch(() => undefined);
    }, DEBOUNCE_MS);
  };

  return (
    <div ref={containerRef} className="flex items-center gap-2 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 rounded border border-[var(--color-border)] shrink-0 cursor-pointer"
        style={{ background: draft }}
        title={`${tokenPath} — click to edit`}
        aria-label={`Edit ${label}`}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <label
          htmlFor={`token-${tokenPath}`}
          className="text-xs text-[var(--color-fg-muted)] truncate"
        >
          {label}
        </label>
        <input
          id={`token-${tokenPath}`}
          type="text"
          value={draft}
          onChange={(e) => commit(e.target.value)}
          spellCheck={false}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-mono"
        />
      </div>
      {open ? <Popover currentValue={draft} onCommit={commit} /> : null}
    </div>
  );
}

function Popover({
  currentValue,
  onCommit,
}: {
  currentValue: string;
  onCommit: (next: string) => void;
}) {
  // Maintain three drafts (hex / oklch / hsl) that mutually sync via culori.
  const initial = parseTriplet(currentValue) ?? {
    hex: "#000000",
    oklch: "oklch(0 0 0)",
    hsl: "hsl(0 0% 0%)",
  };
  const [hex, setHex] = useState(initial.hex);
  const [oklch, setOklch] = useState(initial.oklch);
  const [hsl, setHsl] = useState(initial.hsl);

  const sync = (next: string, source: "hex" | "oklch" | "hsl") => {
    const trip = parseTriplet(next);
    if (!trip) {
      // Keep the user's literal input in their field; leave the others alone.
      if (source === "hex") setHex(next);
      if (source === "oklch") setOklch(next);
      if (source === "hsl") setHsl(next);
      return;
    }
    setHex(trip.hex);
    setOklch(trip.oklch);
    setHsl(trip.hsl);
    onCommit(trip.oklch);
  };

  return (
    <div
      role="dialog"
      className="absolute z-10 top-9 left-0 w-72 p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg flex flex-col gap-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={parseTriplet(hex)?.hex ?? "#000000"}
          onChange={(e) => sync(e.target.value, "hex")}
          className="h-9 w-9 rounded border border-[var(--color-border)] cursor-pointer"
        />
        <div
          className="flex-1 h-9 rounded border border-[var(--color-border)]"
          style={{ background: oklch || hex }}
          title="Preview"
        />
      </div>
      <Field label="HEX" value={hex} onChange={(v) => sync(v, "hex")} />
      <Field label="OKLCH" value={oklch} onChange={(v) => sync(v, "oklch")} />
      <Field label="HSL" value={hsl} onChange={(v) => sync(v, "hsl")} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 text-[var(--color-fg-muted)] uppercase tracking-wider">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono"
      />
    </label>
  );
}
