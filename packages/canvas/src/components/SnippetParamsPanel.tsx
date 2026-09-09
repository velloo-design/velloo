import type { Snippet, SnippetParam } from "@velloo/schema";
import { formatParamDefault } from "../snippet-params.ts";
import { Badge } from "./ui/badge.tsx";

interface SnippetParamsPanelProps {
  snippet: Snippet;
}

/**
 * The params rail of the snippet editor — a read-only reading of the snippet's
 * signature.
 *
 * Editing params here used to be possible and was a trap: a param is a
 * contract with every instance across every screen, and the panel could only
 * ever change one side of it. Dropping a param left each caller passing an arg
 * that no longer resolves, so screens the user wasn't looking at stopped
 * rendering, and the panel had no way to even name them. An agent changes the
 * declaration and the call sites in one pass, which is the only version of
 * this edit that stays consistent.
 */
export function SnippetParamsPanel({ snippet }: SnippetParamsPanelProps) {
  return (
    <section className="border-b flex flex-col gap-1 px-3 pt-3 pb-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Params
        </div>
        {/* The why is a tooltip, not a paragraph — the rail is a signature, and
            a standing explanation of an action you can't take is just noise. */}
        <span
          className="text-[10px] text-muted-foreground"
          title="A param is a contract with every instance of this snippet across every screen. Changing one here could only ever change this side of it, so a removed param left each caller passing an arg that no longer resolved — breaking screens you weren't looking at. Ask your agent: update_snippet moves the declaration and the call sites in one pass."
        >
          read-only
        </span>
      </div>
      {snippet.params.length === 0 ? (
        <div className="text-[11px] text-muted-foreground mt-1">No params.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {snippet.params.map((p) => (
            <li key={p.name} className="rounded-md border bg-background">
              <ParamRow param={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ParamRow({ param }: { param: SnippetParam }) {
  const summary = formatParamDefault(param);
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <span className="font-mono text-[11px] truncate">${param.name}</span>
      <Badge variant="outline" className="text-[9px] font-mono shrink-0">
        {param.type}
      </Badge>
      {summary ? (
        <span className="text-[10px] text-muted-foreground truncate">= {summary}</span>
      ) : (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">required</span>
      )}
      {param.description ? (
        <span className="text-[10px] text-muted-foreground truncate" title={param.description}>
          · {param.description}
        </span>
      ) : null}
    </div>
  );
}
