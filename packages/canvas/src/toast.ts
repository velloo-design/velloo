/**
 * Thin wrapper around Sonner's imperative API. Keeps the existing
 * `pushToast` / `toastError` callsites stable while delegating to
 * Sonner's queue + portal + animation.
 *
 * The actual `<Toaster />` is mounted once at the root of `App.tsx`
 * from `./components/ui/sonner`.
 */
import { toast as sonner } from "sonner";

export type ToastKind = "info" | "success" | "error";

export function pushToast(input: {
  kind?: ToastKind;
  title?: string;
  message: string;
  ttl?: number;
}): string {
  const kind = input.kind ?? "info";
  const duration = input.ttl ?? (kind === "error" ? 6000 : 3500);
  const message = input.title ?? input.message;
  const description = input.title ? input.message : undefined;
  const opts = { description, duration } as const;

  let id: string | number;
  if (kind === "success") {
    id = sonner.success(message, opts);
  } else if (kind === "error") {
    id = sonner.error(message, opts);
  } else {
    id = sonner(message, opts);
  }
  return String(id);
}

export function toastError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return pushToast({ kind: "error", message: msg || fallback });
}
