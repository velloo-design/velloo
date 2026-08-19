import type { Extension } from "@velloo/schema";
import type * as React from "react";
import { ExtensionPlaceholder } from "./placeholder.tsx";

/**
 * SSR marker for a `render:"live"` extension. The server still renders
 * static HTML; this emits a sized box carrying the data the client
 * `LIVE_RUNTIME` needs to mount the real host component into it (a "live
 * island"). The `ExtensionPlaceholder` rendered inside is the SSR
 * skeleton — it's what shows before the bundle loads and what stays if
 * the bundle/render fails, so the worst case is "no worse than today".
 *
 * `data-node-path` lands on the marker (not the inner placeholder) so
 * the selection overlay measures the laid-out box and clicks resolve to
 * this node. The client mount keeps `pointer-events: none`, so selection
 * stays authoritative (visual-only preview).
 */

// Attributes the renderer injects onto every node — not component props,
// so they're excluded from the serialized live-props. `children` is
// dropped too: a live island is driven by its declared props, and React
// children aren't JSON-serializable.
const NON_PROP_KEYS = new Set(["data-node-path", "children", "className"]);

function serializeProps(resolved: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (NON_PROP_KEYS.has(key)) continue;
    out[key] = value;
  }
  try {
    return JSON.stringify(out);
  } catch {
    return "{}";
  }
}

interface LiveMarkerProps {
  /** Component id (e.g. "PriceChart"); the bundle exports it under this key. */
  id: string;
  /** Extension descriptor — drives the placeholder skeleton + carries importPath. */
  extension: Extension;
  /** Props the agent set on the node (plus renderer-injected attrs to strip). */
  resolvedProps: Record<string, unknown>;
  "data-node-path"?: string;
  className?: string;
}

export function LiveIslandMarker({
  id,
  extension,
  resolvedProps,
  className,
  ...rest
}: LiveMarkerProps): React.ReactElement {
  // Default to a 16:9 box; `fit:"content"` opts out so a fixed-height chart
  // (or an `absolute inset-0` overlay) drives its own height instead of
  // fighting the aspect ratio.
  const sizing = extension.fit === "content" ? "relative w-full" : "relative aspect-video w-full";
  const wrapperClassName = [sizing, className].filter(Boolean).join(" ");
  return (
    <div
      data-live-node="true"
      data-live-ref={id}
      data-live-props={serializeProps(resolvedProps)}
      className={wrapperClassName}
      {...rest}
    >
      <ExtensionPlaceholder
        id={id}
        extension={extension}
        resolvedProps={resolvedProps}
        className={className}
      />
    </div>
  );
}
