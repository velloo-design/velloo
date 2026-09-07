import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared furniture for the settings panes: a section heading, a
 * label/description/control row, and the read-only fact line. Kept here so
 * the three scopes stay visually identical without repeating class strings.
 */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A group of {@link SettingRow}s, hairline-separated. */
export function SettingRows({ children }: { children: ReactNode }) {
  return <div className="mt-2 divide-y divide-border/70">{children}</div>;
}

export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  /** Id of the control this row labels. Omit for rows whose control carries its own label. */
  htmlFor?: string;
  children: ReactNode;
}) {
  const labelClass = "block text-[13px] font-medium text-foreground";
  return (
    <div className="flex items-center justify-between gap-6 py-2.5">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClass}>
            {label}
          </label>
        ) : (
          <div className={labelClass}>{label}</div>
        )}
        {description ? (
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-3">{children}</div>
    </div>
  );
}

/**
 * One `label: value` line in a scope's read-only facts block. `stacked` is for
 * a value that is itself a list (a folder's libraries): the rows sit under each
 * other and the label holds the top line rather than floating beside the middle.
 */
export function Fact({
  label,
  stacked,
  children,
}: {
  label: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex gap-2 text-[12px]", stacked ? "items-start" : "items-center")}>
      <span className="w-[68px] shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex min-w-0 text-foreground",
          stacked ? "flex-col items-start gap-1" : "items-center gap-1.5",
        )}
      >
        {children}
      </span>
    </div>
  );
}
