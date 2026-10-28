import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string | undefined;
  icon?: ReactNode;
}

/**
 * A single choice shown as cards. Each card is a native radio under its label,
 * so the group keeps the browser's own keyboard behaviour and announcements.
 */
export function Choices<T extends string>({
  label,
  choices,
  value,
  onChange,
  columns = 1,
}: {
  label: string;
  choices: Choice<T>[];
  value: T | undefined;
  onChange(value: T): void;
  columns?: 1 | 2;
}) {
  const name = useId();
  return (
    <fieldset className={cn("grid gap-2", columns === 2 && "sm:grid-cols-2")}>
      <legend className="sr-only">{label}</legend>
      {choices.map((choice) => {
        const checked = choice.value === value;
        return (
          <label
            key={choice.value}
            className={cn(
              "group flex w-full cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
              "hover:bg-accent/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
              checked && "border-primary bg-accent/40 ring-1 ring-primary",
            )}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={checked}
              onChange={() => onChange(choice.value)}
              className="sr-only"
            />
            {choice.icon ? (
              <span
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4",
                  checked && "bg-primary text-primary-foreground",
                )}
              >
                {choice.icon}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium leading-snug">{choice.label}</span>
              {choice.hint ? (
                <span className="text-xs leading-snug text-muted-foreground">{choice.hint}</span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                checked && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {checked ? <Check className="size-3" /> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
