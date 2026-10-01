/**
 * How a component reaches the screen — the one vocabulary `component_status`,
 * the canvas's fidelity routes and a capture's metadata all speak, so a badge
 * and an agent never read the same verdict two ways.
 *
 * - `exact` / `adapted` / `fallback` — a browser bundle's source for it (the
 *   app's own file, a canvas-safe adaptation, a stand-in).
 * - `unstyled` / `proxy` / `unavailable` — a repository component that
 *   rendered without the app's styles, has a proxy snippet standing in, or
 *   cannot render in the canvas at all.
 * - `server-rendered` — the server render is what the screen shows; nothing
 *   client-mounts it.
 * - `unchecked` — nothing has established how it renders. Kept distinct so an
 *   answer never asserts a verdict it does not have.
 */
export type ComponentFidelity =
  | "exact"
  | "adapted"
  | "fallback"
  | "unstyled"
  | "proxy"
  | "unavailable"
  | "server-rendered"
  | "unchecked";
