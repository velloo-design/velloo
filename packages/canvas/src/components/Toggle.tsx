interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
  label?: string;
}

/**
 * Simple iOS-style switch. Themed via app CSS variables so it flips with
 * the canvas chrome's light/dark mode.
 */
export function Toggle({ checked, onChange, id, label }: Props) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors " +
        (checked
          ? "bg-[var(--color-accent)]"
          : "bg-[var(--color-border)] hover:bg-[var(--color-fg-muted)]")
      }
    >
      <span
        className={
          "absolute top-0.5 inline-block h-4 w-4 rounded-full bg-white shadow transition-transform " +
          (checked ? "translate-x-4" : "translate-x-0.5")
        }
      />
    </button>
  );
}
