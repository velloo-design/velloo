import { isComponentNode, type Node } from "@velloo/schema";
import { ChevronRight, Copy, Plus, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import {
  mutate,
  type RepoCatalogEntry,
  type RepoPropDescriptor,
  repoImportLine,
  repoRenderUrl,
} from "../api.ts";
import { pathFromString } from "../path.ts";
import { type CanvasState, repoEntryFor, useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { EmptyState } from "./EmptyState.tsx";
import { BackButton, DetailBreadcrumb } from "./LibraryDetailChrome.tsx";
import { RepoFidelityChip, useRepoStatus } from "./RepoFidelity.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
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

type Placement = {
  screenId: string;
  parentPath: number[];
  index?: number;
  /** "to Home", "inside Card", "after Button" — said back in the toast. */
  where: string;
};

/**
 * Where "Add to screen" puts the component: inside the selected node when it
 * holds children (or is a repo component that takes them), right after it
 * when it's a leaf, else at the end of the active screen's root.
 * Snippet-editor selections are skipped — their synthetic screens aren't
 * something `add_node` can address.
 */
export function placementTarget(
  s: Pick<CanvasState, "selection" | "screens" | "currentScreenId" | "repoCatalog">,
): Placement | null {
  const sel = s.selection;
  const screen = sel && !sel.screenId.startsWith("snippet:") ? s.screens[sel.screenId] : undefined;
  if (sel && screen) {
    const path = pathFromString(sel.path);
    let node: unknown = screen.tree;
    for (const i of path) node = (node as { children?: unknown[] } | undefined)?.children?.[i];
    const n = node as Node | undefined;
    const label = n && isComponentNode(n) ? n.$ref : "the selection";
    const holds =
      path.length === 0 ||
      (n !== undefined && isComponentNode(n) && (n.children?.length ?? 0) > 0) ||
      (n !== undefined &&
        isComponentNode(n) &&
        n.$repo !== undefined &&
        repoEntryFor(s.repoCatalog, n.$repo)?.acceptsChildren === true);
    if (holds) return { screenId: sel.screenId, parentPath: path, where: `inside ${label}` };
    return {
      screenId: sel.screenId,
      parentPath: path.slice(0, -1),
      index: (path.at(-1) ?? 0) + 1,
      where: `after ${label}`,
    };
  }
  if (!s.currentScreenId) return null;
  const name = s.screens[s.currentScreenId]?.name ?? s.currentScreenId;
  return { screenId: s.currentScreenId, parentPath: [], where: `to ${name}` };
}

async function addToScreen(entry: RepoCatalogEntry, stateIndex: number): Promise<void> {
  const target = placementTarget(useCanvas.getState());
  if (!target) {
    pushToast({ kind: "info", message: "Open a screen first — there's nowhere to add it." });
    return;
  }
  try {
    const { path } = await mutate.addNode({
      screenId: target.screenId,
      parentPath: target.parentPath,
      ...(target.index !== undefined ? { index: target.index } : {}),
      componentRef: entry.name,
      repo: entry.identity,
      props: entry.states[stateIndex]?.props ?? {},
    });
    pushToast({
      kind: "success",
      message: `Added ${entry.name} ${target.where}.`,
      action: {
        label: "Show",
        onClick: () => {
          const store = useCanvas.getState();
          store.closeLibrary();
          store.setSelection({ screenId: target.screenId, path: path.join(".") });
        },
      },
    });
  } catch (err) {
    toastError(err, `Could not add ${entry.name}`);
  }
}

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
            <div className="ml-auto">
              <Button size="sm" onClick={() => void addToScreen(entry, 0)}>
                <Plus />
                Add to screen
              </Button>
            </div>
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
          <section className="px-8 pt-6 flex flex-col gap-1 text-sm">
            <div className={SECTION_LABEL}>Fidelity</div>
            {status.note ? <p>{status.note}</p> : null}
            {status.remedy ? <p className="text-muted-foreground">{status.remedy}</p> : null}
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
                  {states.length > 1 ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void addToScreen(entry, i)}
                    >
                      <Plus />
                      Add
                    </Button>
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
