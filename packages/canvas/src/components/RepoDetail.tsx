import { ChevronRight, Copy, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { type RepoPropDescriptor, repoImportLine, repoRenderUrl } from "../api.ts";
import { useCanvas } from "../store.ts";
import { pushToast } from "../toast.ts";
import { EmptyState } from "./EmptyState.tsx";
import { BackButton, DetailBreadcrumb } from "./LibraryDetailChrome.tsx";
import { RepoFidelityChip, useRepoStatus } from "./RepoFidelity.tsx";
import { RepoPreviewHelp } from "./RepoPreviewHelp.tsx";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";

const SECTION_LABEL = "text-[10px] uppercase tracking-wider text-muted-foreground font-medium";

async function copyImport(line: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(line);
    pushToast({ kind: "success", message: "Import copied." });
  } catch {
    pushToast({ kind: "info", message: line });
  }
}

/** Library detail for one of the host app's own components. */
export function RepoDetail({ id }: { id: string }) {
  const catalog = useCanvas((s) => s.repoCatalog);
  const repoStatus = useCanvas((s) => s.repoStatus);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const dark = useCanvas((s) => s.designMode === "dark");
  const openLibrary = useCanvas((s) => s.openLibrary);
  const refreshRepoStatus = useCanvas((s) => s.refreshRepoStatus);

  const entry = catalog?.entries.find((e) => e.id === id) ?? null;
  const parts = useMemo(
    () =>
      entry
        ? (catalog?.entries ?? []).filter(
            (e) =>
              e.id !== entry.id &&
              e.identity.member !== undefined &&
              e.identity.importPath === entry.identity.importPath &&
              e.identity.exportName === entry.identity.exportName &&
              e.identity.app === entry.identity.app,
          )
        : [],
    [catalog, entry],
  );
  useRepoStatus(entry ? [entry.id] : []);

  if (!catalog) return null;
  if (!entry) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <div className="px-8 pt-4">
          <BackButton onClick={() => openLibrary(null)} />
        </div>
        <EmptyState
          icon={SearchX}
          title={`${id} isn't in the repo catalog`}
          hint="The app may no longer use it, or discovery hasn't seen it yet."
        />
      </div>
    );
  }

  const status = repoStatus[entry.id];
  const sourceLabel =
    entry.source === "local" ? "This app" : (entry.packageName ?? entry.identity.importPath);
  const importLine = repoImportLine(entry);
  const states = entry.states.length > 0 ? entry.states : [null];

  return (
    <div className="flex-1 overflow-auto bg-background" data-repo-detail={entry.id}>
      <div className="mx-auto w-full max-w-5xl flex flex-col">
        <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm border-b px-8 pt-4 pb-5">
          <BackButton onClick={() => openLibrary(null)} />
          <div className="mt-3">
            <DetailBreadcrumb category={`Repo · ${sourceLabel}`} name={entry.id} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight">{entry.id}</h1>
            <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
              {entry.source === "local" ? "app" : "package"}
            </Badge>
            {entry.recipe ? (
              <Badge variant="outline" className="text-[10px] font-mono">
                {entry.recipe}
              </Badge>
            ) : null}
            <RepoFidelityChip diagnostic={status} />
          </div>
          {entry.description ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{entry.description}</p>
          ) : null}
          {entry.qualifiedBecause ? (
            <p className="mt-1 text-xs text-muted-foreground italic">
              Placed as <span className="font-mono">{entry.id}</span>: {entry.qualifiedBecause}
            </p>
          ) : null}
          <InputGroup className="mt-3 h-8 max-w-xl">
            <InputGroupInput
              readOnly
              value={importLine}
              aria-label="Import"
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Copy import"
                title="Copy import"
                onClick={() => void copyImport(importLine)}
              >
                <Copy />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </header>

        {status && (status.note || status.remedy) ? (
          <section className="px-8 pt-6 flex flex-col gap-2 text-sm">
            <div className={SECTION_LABEL}>Fidelity</div>
            {status.note ? <p>{status.note}</p> : null}
            {status.remedy ? <p className="text-muted-foreground">{status.remedy}</p> : null}
            {status.status !== "exact" && status.status !== "adapted" ? (
              <RepoPreviewHelp
                entry={entry}
                diagnostic={status}
                previewLabel={
                  catalog?.apps.find((app) => app.app === entry.identity.app)?.preview.label
                }
              />
            ) : null}
          </section>
        ) : null}

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className={SECTION_LABEL}>Preview</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {states.map((state, i) => (
              <Card key={state ? `${state.name}-${i}` : "default"} className="py-0 gap-0">
                <iframe
                  src={repoRenderUrl(entry.id, {
                    state: i,
                    w: 480,
                    h: 200,
                    v: themeVersion,
                    dark,
                  })}
                  title={`${entry.id} ${state?.name ?? "preview"}`}
                  loading="lazy"
                  // The mount reports what it found (a throw, a missing provider)
                  // a beat after load; ask again so the chip and note catch up.
                  onLoad={() => setTimeout(() => void refreshRepoStatus([entry.id]), 1500)}
                  className="block w-full h-[200px] border-0"
                />
                <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
                  <span className="font-medium">{state?.name ?? "default"}</span>
                  {state ? (
                    <span className="text-muted-foreground truncate" title={state.at}>
                      {state.source}
                      {state.at ? ` · ${state.at}` : ""}
                    </span>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </section>

        {entry.props.length > 0 ? (
          <section className="px-8 pb-6 flex flex-col gap-3">
            <div className={SECTION_LABEL}>Props</div>
            <RepoPropsTable props={entry.props} />
          </section>
        ) : null}

        {parts.length > 0 || (entry.parts?.length ?? 0) > 0 ? (
          <section className="px-8 pb-6 flex flex-col gap-3">
            <div className={SECTION_LABEL}>Parts</div>
            <div className="flex flex-wrap gap-1.5">
              {(parts.length > 0
                ? parts.map((p) => p.id)
                : (entry.parts ?? []).map((p) => `${entry.name}.${p}`)
              ).map((name) => (
                <Badge key={name} variant="outline" className="font-mono text-[11px]">
                  {name}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        {entry.provenance.length > 0 ? (
          <section className="px-8 pb-10 flex flex-col gap-3">
            <div className={SECTION_LABEL}>Used at</div>
            <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
              {entry.provenance.map((at) => (
                <li key={at}>{at}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RepoPropsTable({ props }: { props: RepoPropDescriptor[] }) {
  const own = props.filter((p) => !p.inherited);
  const inherited = props.filter((p) => p.inherited);
  const [showInherited, setShowInherited] = useState(false);
  return (
    <Card className="py-0">
      <Table>
        <TableHeader className="sr-only">
          <TableRow>
            <TableHead>Prop</TableHead>
            <TableHead>Accepts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {own.map((p) => (
            <RepoPropRow key={p.name} prop={p} />
          ))}
        </TableBody>
      </Table>
      {inherited.length > 0 ? (
        <Collapsible open={showInherited} onOpenChange={setShowInherited}>
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-t px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight
              size={12}
              className={`transition-transform ${showInherited ? "rotate-90" : ""}`}
            />
            {inherited.length} inherited prop{inherited.length === 1 ? "" : "s"}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table>
              <TableBody>
                {inherited.map((p) => (
                  <RepoPropRow key={p.name} prop={p} />
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </Card>
  );
}

function RepoPropRow({ prop: p }: { prop: RepoPropDescriptor }) {
  return (
    <TableRow data-prop={p.name}>
      <TableCell className="w-40 py-3 align-top">
        <div className="font-mono text-xs font-medium">{p.name}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {[p.optional ? "optional" : "required", p.slot ? "slot" : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </TableCell>
      <TableCell className="py-3 whitespace-normal">
        <div className="flex flex-row flex-wrap items-center gap-1">
          {p.enumValues && p.enumValues.length > 0 ? (
            p.enumValues.map((v) => (
              <Badge key={String(v)} variant="outline" className="font-mono text-[10px]">
                {String(v)}
              </Badge>
            ))
          ) : (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-muted-foreground max-w-full truncate"
              title={p.type}
            >
              {p.type || p.control}
            </Badge>
          )}
          {p.defaultValue ? (
            <span className="ml-2 text-xs text-muted-foreground">
              default: <span className="font-mono">{p.defaultValue}</span>
            </span>
          ) : null}
        </div>
        {p.description ? (
          <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
        ) : null}
        {!p.serializable && p.constraint ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{p.constraint}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
