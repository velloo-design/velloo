import { failureLine, type ScreenRenderFailure } from "../api/preflight.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog.tsx";

interface Props {
  /** Pre-fetched failures (the caller checked before starting); null = closed. */
  failures: ScreenRenderFailure[] | null;
  /** What the user asked for, as a button verb: "Export", "Publish". */
  verb: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation before shipping a screen whose component failed to render.
 *
 * The canvas shows a diagnostic placeholder in place of a component that
 * threw, which is what keeps one bad node from taking the screen down. That is
 * fine while designing, because the author can see the box. It is not fine in
 * a PDF sent to a client or on a share link, where the reader has no way to
 * tell a placeholder from a design — so the decision to send it anyway should
 * be one somebody made on purpose.
 */
export function RenderFailureDialog({ failures, verb, onCancel, onConfirm }: Props) {
  const count = failures?.length ?? 0;
  const screens = new Set(failures?.map((failure) => failure.screenId)).size;

  return (
    <AlertDialog open={failures !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? "A component" : `${count} components`} failed to render
          </AlertDialogTitle>
          <AlertDialogDescription>
            On {screens === 1 ? "1 screen" : `${screens} screens`}. Each one appears as a
            placeholder box in the output, not as the component — whoever opens it will see the
            error, not the design.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="max-h-48 overflow-y-auto scroll-stable rounded-md border bg-muted/30 p-2 text-xs font-mono">
          {failures?.map((failure) => (
            <li key={`${failure.screenId}:${failure.componentId}`} className="py-0.5">
              {failureLine(failure)}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{verb} anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
