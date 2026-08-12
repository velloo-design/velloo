import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { dismissToast, type Toast, useToasts } from "../toast.ts";

const ICON_BY_KIND = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
} as const;

export function Toaster(): React.ReactElement | null {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const Icon = ICON_BY_KIND[toast.kind];
  const accent =
    toast.kind === "error"
      ? "text-[var(--color-destructive,red)]"
      : toast.kind === "success"
        ? "text-emerald-500"
        : "text-[var(--color-fg-muted)]";
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className="pointer-events-auto flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 shadow-md"
    >
      <Icon size={14} strokeWidth={2} className={`mt-0.5 shrink-0 ${accent}`} />
      <div className="flex-1 min-w-0">
        {toast.title ? (
          <div className="text-xs font-medium text-[var(--color-fg)]">{toast.title}</div>
        ) : null}
        <div className="text-xs text-[var(--color-fg)] break-words">{toast.message}</div>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        title="Dismiss"
        className="ml-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
