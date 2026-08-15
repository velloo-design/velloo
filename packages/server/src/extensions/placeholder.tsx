import type { Extension, ExtensionPropDescriptor } from "@velloo/schema";
import * as React from "react";

/**
 * Tier-1 canvas rendering for an extension node. The user's AI agent
 * declares an extension (DataTable, PriceChart, BrandHero) via the
 * `add_extension` MCP tool; velloo doesn't have a React implementation
 * for it, so the canvas shows this placeholder card carrying the
 * component id and a compact summary of the resolved props.
 *
 * Codegen still emits a real `import { DataTable } from <importPath>`
 * — the placeholder is only what the canvas mounts. Real visual
 * fidelity is Tier 2 (Sprint Y.2).
 *
 * Tailwind classes use the semantic theme tokens
 * (`border-border`, `bg-muted/40`, `text-muted-foreground`) every
 * shipping provider's `@theme` block defines, so the placeholder
 * theme-flips alongside the rest of the canvas.
 */

const MAX_LABEL_CHARS = 80;

/**
 * Render a prop value as a short, single-line string the inspector
 * could fit in a chip. Long strings get truncated; objects collapse to
 * `{}`; arrays collapse to `[n]`. Booleans and numbers print raw.
 */
function summarizeValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") {
    return value.length > MAX_LABEL_CHARS
      ? `"${value.slice(0, MAX_LABEL_CHARS - 1)}…"`
      : `"${value}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") return "{}";
  return String(value);
}

function pickShownProps(
  declared: ExtensionPropDescriptor[],
  resolved: Record<string, unknown>,
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const prop of declared) {
    if (prop.name in resolved) {
      out.push({ name: prop.name, value: summarizeValue(resolved[prop.name]) });
    } else if (prop.defaultValue !== undefined) {
      out.push({ name: prop.name, value: prop.defaultValue });
    }
    if (out.length >= 6) break;
  }
  return out;
}

interface PlaceholderProps {
  /** Component id (e.g. "DataTable"). */
  id: string;
  /** Extension descriptor — props schema + importPath. */
  extension: Extension;
  /** Props the agent set on the node. */
  resolvedProps: Record<string, unknown>;
  /** Pass through any data-* attributes the renderer attached for selection. */
  "data-node-path"?: string;
  /** Rendering this with className lets agents tweak layout without bypassing the placeholder. */
  className?: string;
}

export function ExtensionPlaceholder({
  id,
  extension,
  resolvedProps,
  className,
  ...rest
}: PlaceholderProps): React.ReactElement {
  const shown = pickShownProps(extension.props, resolvedProps);
  const trimmedClassName = [
    "flex flex-col gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 text-card-foreground",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      data-velloo-extension={id}
      data-velloo-extension-path={extension.importPath}
      className={trimmedClassName}
      {...rest}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-foreground">{id}</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          extension
        </span>
      </div>
      {extension.description ? (
        <div className="text-xs text-muted-foreground">{extension.description}</div>
      ) : null}
      {shown.length > 0 ? (
        <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px] leading-tight">
          {shown.map((row) => (
            <React.Fragment key={row.name}>
              <span className="text-muted-foreground">{row.name}</span>
              <span className="truncate">{row.value}</span>
            </React.Fragment>
          ))}
        </div>
      ) : null}
      <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
        {extension.importPath}
      </div>
    </div>
  );
}
