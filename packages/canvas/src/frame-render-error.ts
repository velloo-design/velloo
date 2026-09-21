import { RENDER_ERROR_META } from "@velloo/renderer/iframe-protocol";

/**
 * What the document in this iframe failed with, or null if it drew a screen.
 *
 * An iframe load reports no status to its parent, and the error document runs
 * no script by design, so the one thing left to read is the document itself —
 * same-origin, so the parent may. The guarded access is for the load that
 * arrives after the element is gone: a frame removed mid-navigation answers
 * with a detached document rather than a screen that rendered.
 */
export function readRenderError(iframe: HTMLIFrameElement | null): string | null {
  try {
    const meta = iframe?.contentDocument?.querySelector(`meta[name="${RENDER_ERROR_META}"]`);
    return meta?.getAttribute("content") || null;
  } catch {
    return null;
  }
}
