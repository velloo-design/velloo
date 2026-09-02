import { RotateCcw } from "lucide-react";
import { Slider } from "../ui/slider.tsx";

interface Props {
  label: string;
  /**
   * The value in slider units — the previewed one while a drag is in flight,
   * the committed one otherwise. Feeding the preview back through here is what
   * moves the thumb: Radix compares against the value it saw at slide start, so
   * a controlled value that never changes also never fires a commit.
   */
  value: number;
  min: number;
  max: number;
  step: number;
  /** Formatted for the readout — "1em", "1.50", "20px". */
  display: string;
  /**
   * False when this control is inherited from the baseline rather than
   * authored on the typeset being edited. Drives the dot, the muted readout,
   * and whether the clear button is offered.
   */
  authored: boolean;
  /** Absent on the baseline typeset, which has nothing to inherit from. */
  onClear?: (() => void) | undefined;
  hint: string;
  /** Every drag tick — paints the preview. */
  onPreview: (value: number) => void;
  /** Pointer-up / keyboard commit — writes through set_typeset. */
  onCommit: (value: number) => void;
}

/**
 * One rhythm control. The dot is the inheritance tell folded in from the
 * typeset-manager exploration: filled means this typeset authors the control,
 * hollow means it follows the baseline and will keep following it.
 */
export function RhythmControl({
  label,
  value,
  min,
  max,
  step,
  display,
  authored,
  onClear,
  hint,
  onPreview,
  onCommit,
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-1.5">
        <span
          aria-hidden
          className={
            "size-1.5 shrink-0 self-center rounded-full " +
            (authored ? "bg-primary" : "border border-muted-foreground/40")
          }
        />
        <span className="text-xs text-muted-foreground">{label}</span>
        {authored ? null : (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
            inherited
          </span>
        )}
        {authored && onClear ? (
          <button
            type="button"
            onClick={onClear}
            title={`Clear ${label} — inherit it from the default typeset again`}
            aria-label={`Clear ${label}`}
            className="ml-auto text-muted-foreground/60 hover:text-foreground cursor-pointer"
          >
            <RotateCcw size={11} />
          </button>
        ) : null}
        <span
          className={
            (authored && onClear ? "" : "ml-auto ") +
            "font-mono text-xs tabular-nums " +
            (authored ? "text-foreground" : "text-muted-foreground/60")
          }
        >
          {display}
        </span>
      </div>
      <Slider
        aria-label={label}
        tone={authored ? "primary" : "muted"}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onPreview(next as number)}
        onValueCommit={([next]) => onCommit(next as number)}
      />
      <span className="text-[10px] text-muted-foreground/80">{hint}</span>
    </div>
  );
}
