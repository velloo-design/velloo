import { Boxes, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RepoCatalogEntry } from "../api.ts";
import { useCanvas } from "../store.ts";
import { RepoFidelityChip, useRepoStatus } from "./RepoFidelity.tsx";
import { Badge } from "./ui/badge.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { Separator } from "./ui/separator.tsx";

interface RepoSource {
  key: string;
  label: string;
  /** Family roots only — parts live on their family's detail page. */
  roots: RepoCatalogEntry[];
  /** Every entry, so a search for a part (`List`) still finds its family. */
  entries: RepoCatalogEntry[];
}

/** One section per place the app imports from: each package, then its own code. */
function groupBySource(entries: RepoCatalogEntry[]): RepoSource[] {
  const sources = new Map<string, RepoSource>();
  for (const entry of entries) {
    const app = entry.identity.app;
    const pkg = entry.packageName ?? entry.identity.importPath;
    const key = entry.source === "local" ? `local:${app ?? ""}` : `package:${pkg}:${app ?? ""}`;
    const base = entry.source === "local" ? "This app" : pkg;
    let source = sources.get(key);
    if (!source) {
      source = { key, label: app ? `${base} · ${app}` : base, roots: [], entries: [] };
      sources.set(key, source);
    }
    source.entries.push(entry);
    if (!entry.identity.member) source.roots.push(entry);
  }
  for (const source of sources.values()) {
    // A family seen only through its parts still needs a row to open it by.
    const rooted = new Set(source.roots.map((r) => r.family));
    for (const entry of source.entries) {
      if (rooted.has(entry.family)) continue;
      rooted.add(entry.family);
      source.roots.push(entry);
    }
    source.roots.sort((a, b) => a.id.localeCompare(b.id));
  }
  // The app's own components lead: they're what no other library offers.
  return [...sources.values()].sort((a, b) => {
    const localA = a.key.startsWith("local:") ? 0 : 1;
    const localB = b.key.startsWith("local:") ? 0 : 1;
    return localA - localB || a.label.localeCompare(b.label);
  });
}

function matchingRoots(source: RepoSource, q: string): RepoCatalogEntry[] {
  if (!q) return source.roots;
  const hitFamilies = new Set(
    source.entries
      .filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .map((e) => e.family),
  );
  return source.roots.filter((root) => hitFamilies.has(root.family));
}

/**
 * The Library's Repo area: the host app's own components, above the
 * provider's shelves. Renders nothing for a folder with no repo catalog.
 */
export function RepoShelves({ query }: { query: string }) {
  const catalog = useCanvas((s) => s.repoCatalog);
  const loadRepoCatalog = useCanvas((s) => s.loadRepoCatalog);

  // The Library mounts without the inspector or tree, which otherwise start it.
  useEffect(() => {
    void loadRepoCatalog();
  }, [loadRepoCatalog]);

  const sources = useMemo(() => groupBySource(catalog?.entries ?? []), [catalog]);
  if (sources.length === 0) return null;

  const q = query.trim().toLowerCase();
  const visible = sources
    .map((source) => ({ source, roots: matchingRoots(source, q) }))
    .filter(({ roots }) => roots.length > 0);
  if (visible.length === 0) return null;

  return (
    <div data-repo-shelves="">
      <div className="px-4 pt-3 pb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-primary">
        <Boxes size={11} strokeWidth={2} />
        <span className="flex-1">Repo</span>
      </div>
      {visible.map(({ source, roots }) => (
        <RepoSection
          key={source.key}
          label={source.label}
          roots={roots}
          // A search opens every section it matched in; otherwise only the
          // app's own components start open, since each open section builds
          // a browser bundle for its status chips.
          forceOpen={q.length > 0}
          defaultOpen={source.key.startsWith("local:") || sources.length === 1}
        />
      ))}
      <Separator className="mx-2 my-3" />
    </div>
  );
}

function RepoSection({
  label,
  roots,
  forceOpen,
  defaultOpen,
}: {
  label: string;
  roots: RepoCatalogEntry[];
  forceOpen: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = forceOpen || open;
  const libraryItem = useCanvas((s) => s.libraryItem);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const repoStatus = useCanvas((s) => s.repoStatus);
  useRepoStatus(
    roots.map((r) => r.id),
    expanded,
  );

  return (
    <Collapsible open={expanded} onOpenChange={setOpen} data-repo-source={label}>
      <CollapsibleTrigger className="w-full px-4 pt-2 pb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground hover:text-foreground">
        <ChevronRight
          size={11}
          strokeWidth={2}
          className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <span className="flex-1 truncate text-left normal-case tracking-normal font-mono">
          {label}
        </span>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal tabular-nums">
          {roots.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col px-2 gap-0.5 pb-1">
          {roots.map((root) => {
            const active = libraryItem?.kind === "repo" && libraryItem.id === root.id;
            return (
              <li key={root.id}>
                <button
                  type="button"
                  data-repo-id={root.id}
                  onClick={() => openLibrary({ kind: "repo", id: root.id })}
                  className={
                    "w-full text-left px-2 py-1 rounded-md text-sm transition-colors flex items-center gap-2 " +
                    (active ? "bg-primary text-primary-foreground" : "hover:bg-muted")
                  }
                >
                  <span className="truncate flex-1">{root.id}</span>
                  {root.parts && root.parts.length > 0 ? (
                    <span
                      className={`text-[10px] tabular-nums ${active ? "" : "text-muted-foreground"}`}
                      title={root.parts.join(", ")}
                    >
                      +{root.parts.length}
                    </span>
                  ) : null}
                  <RepoFidelityChip diagnostic={repoStatus[root.id]} />
                </button>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
