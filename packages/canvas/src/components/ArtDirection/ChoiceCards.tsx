import { useId } from "react";

/** A small set of options as cards, one picked: native radios, so keyboard and screen readers get them free. */
export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; title: string; body: string }[];
  onChange: (value: T) => void;
  className?: string | undefined;
}) {
  const name = useId();
  return (
    <fieldset className={className}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="block cursor-pointer rounded-xl border p-3.5 text-left transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5 has-checked:ring-1 has-checked:ring-primary has-focus-visible:ring-2"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          <span className="block text-sm font-medium">{o.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{o.body}</span>
        </label>
      ))}
    </fieldset>
  );
}
