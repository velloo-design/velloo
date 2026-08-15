// Velloo-flavored Calendar. The shadcn Calendar wraps react-day-picker
// (a heavy dep with its own state); design mode just needs a styled
// month grid so designers can preview date-picker UIs. We render a
// static month synchronously from `month` + `selected` props.
//
// The agent's emitted code uses the real shadcn Calendar (which imports
// react-day-picker) — this is design-only.
import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils.ts";

export interface CalendarProps extends React.ComponentProps<"div"> {
  /** ISO date string (YYYY-MM-DD) to drive which month is shown. */
  month?: string;
  /** ISO date string to render as the selected day. */
  selected?: string;
  /** Show week numbers down the left edge. */
  showWeekNumbers?: boolean;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function Calendar({
  className,
  month,
  selected,
  showWeekNumbers = false,
  ...props
}: CalendarProps) {
  const today = new Date();
  const ref = parseDate(month) ?? startOfMonth(today);
  const sel = parseDate(selected);
  const first = startOfMonth(ref);
  const lead = first.getDay();
  const total = daysInMonth(ref);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let i = 1; i <= total; i++) cells.push(new Date(ref.getFullYear(), ref.getMonth(), i));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div
      data-slot="calendar"
      className={cn("inline-flex flex-col gap-3 rounded-md border bg-background p-3", className)}
      {...props}
    >
      <div className="flex items-center justify-between text-sm font-medium">
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded hover:bg-accent"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span>
          {MONTH_LABELS[ref.getMonth()]} {ref.getFullYear()}
        </span>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded hover:bg-accent"
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <table className="border-collapse text-center text-sm">
        <thead>
          <tr className="text-muted-foreground">
            {showWeekNumbers ? <th className="w-8" /> : null}
            {DAY_LABELS.map((d) => (
              <th key={d} className="size-9 font-normal">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, weekIdx) => {
            const week = cells.slice(weekIdx * 7, weekIdx * 7 + 7);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: month + week index is stable
              <tr key={`week-${weekIdx}`}>
                {showWeekNumbers ? (
                  <td className="size-9 text-xs text-muted-foreground">{weekIdx + 1}</td>
                ) : null}
                {week.map((d, dayIdx) => {
                  if (!d)
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: empty cells are stable per week+day index
                      <td key={`empty-${weekIdx}-${dayIdx}`} className="size-9" />
                    );
                  const isSelected = sel?.toDateString() === d.toDateString();
                  const isToday = today.toDateString() === d.toDateString();
                  return (
                    <td
                      key={d.toDateString()}
                      className={cn(
                        "size-9 cursor-default rounded-md text-sm",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : isToday
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent",
                      )}
                    >
                      {d.getDate()}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
