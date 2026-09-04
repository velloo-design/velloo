import type { ReactNode } from "react";

interface Props {
  title: string;
  hint?: string | undefined;
  /** Optional call-to-action rendered under the hint. */
  action?: ReactNode | undefined;
}

export function EmptyState({ title, hint, action }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-12">
      <div className="max-w-md">
        <div className="text-base font-medium">{title}</div>
        {hint ? <div className="mt-2 text-sm text-muted-foreground">{hint}</div> : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
