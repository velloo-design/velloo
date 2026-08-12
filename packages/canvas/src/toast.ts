/**
 * Minimal toast pub/sub. Tiny on purpose — no animation queue, no batching,
 * just a list of active toasts that auto-prune after `ttl` ms. Subscribers
 * are notified on every change; the Toaster component is the only consumer.
 */
import { useSyncExternalStore } from "react";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  title?: string;
  message: string;
  /** Milliseconds before auto-dismiss. */
  ttl: number;
  expiresAt: number;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const l of listeners) l();
}

export function pushToast(input: {
  kind?: ToastKind;
  title?: string;
  message: string;
  ttl?: number;
}): string {
  const ttl = input.ttl ?? (input.kind === "error" ? 6000 : 3500);
  const toast: Toast = {
    id: `t-${nextId++}`,
    kind: input.kind ?? "info",
    title: input.title,
    message: input.message,
    ttl,
    expiresAt: Date.now() + ttl,
  };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismissToast(toast.id), ttl);
  return toast.id;
}

export function dismissToast(id: string): void {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function toastError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : fallback;
  return pushToast({ kind: "error", message: msg || fallback });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
