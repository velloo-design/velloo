import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";

interface Props {
  open: boolean;
  title: string;
  /** Also the input's accessible name. */
  placeholder: string;
  submitLabel: string;
  maxLength: number;
  value: string;
  onValueChange(next: string): void;
  onSubmit(): void;
  onCancel(): void;
}

/**
 * The one-field "name this" dialog behind every create, rename and
 * move-to-new-board flow. Submit stays disabled until the name has a
 * non-space character; trimming is the caller's, since only it knows what
 * the name is for.
 */
export function NameDialog({
  open,
  title,
  placeholder,
  submitLabel,
  maxLength,
  value,
  onValueChange,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={placeholder}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={value.trim().length === 0}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
