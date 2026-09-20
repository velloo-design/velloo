import type { RepoComponentRef } from "@velloo/schema";
import { Boxes, ChevronRight, LibraryBig } from "lucide-react";
import { useState } from "react";
import type { RepoCatalogEntry, RepoPropDescriptor } from "../api.ts";
import { useCanvas } from "../store.ts";
import { PropField } from "./PropField.tsx";
import { RepoFidelityChip, useRepoStatus } from "./RepoFidelity.tsx";
import { Button } from "./ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";

/**
 * Identity, fidelity and styling story for a node that is one of the app's
 * own components. Shown even when the catalog doesn't know the identity — the
 * node still renders from its import, and saying so beats an empty pane.
 */
export function RepoInspectorBlock({
  repo,
  entry,
}: {
  repo: RepoComponentRef;
  entry: RepoCatalogEntry | null;
}) {
  const catalog = useCanvas((s) => s.repoCatalog);
  const status = useCanvas((s) => (entry ? s.repoStatus[entry.id] : undefined));
  const openLibrary = useCanvas((s) => s.openLibrary);
  useRepoStatus(entry ? [entry.id] : []);

  const exportLabel = [repo.exportName, repo.member].filter(Boolean).join(".");
  // Parts open on their family's page; a family seen only through its parts
  // has no root entry, so the part's own page stands in.
  const libraryId = entry
    ? (catalog?.entries.find(
        (e) =>
          !e.identity.member &&
          e.identity.importPath === entry.identity.importPath &&
          e.identity.exportName === entry.identity.exportName &&
          e.identity.app === entry.identity.app,
      )?.id ?? entry.id)
    : null;

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-repo-block="">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <Boxes size={12} strokeWidth={2} />
        <span className="flex-1">App component</span>
        <RepoFidelityChip diagnostic={status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Import</dt>
        <dd className="font-mono truncate" title={repo.importPath}>
          {repo.importPath}
        </dd>
        <dt className="text-muted-foreground">Export</dt>
        <dd className="font-mono truncate">{exportLabel}</dd>
        {repo.app ? (
          <>
            <dt className="text-muted-foreground">App</dt>
            <dd className="font-mono truncate">{repo.app}</dd>
          </>
        ) : null}
      </dl>
      {status && status.status !== "exact" && status.note ? (
        <p className="text-xs text-muted-foreground">{status.note}</p>
      ) : null}
      {entry ? (
        <p className="text-xs text-muted-foreground" data-repo-styling="">
          {entry.recipe
            ? `Styled by ${entry.recipe}'s theme — Velloo theme edits reach it through the recipe.`
            : "Styled by the app's own CSS."}
        </p>
      ) : catalog ? (
        <p className="text-xs text-muted-foreground" data-repo-missing="">
          This import is not in the catalog — it still renders from the app, but Velloo has no props
          or previews for it.
        </p>
      ) : null}
      {libraryId ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start -ml-2 text-muted-foreground"
          onClick={() => openLibrary({ kind: "repo", id: libraryId })}
        >
          <LibraryBig />
          Open in Library
        </Button>
      ) : null}
    </section>
  );
}

/**
 * The repo entry's props as controls — never the provider manifest, whose
 * same-named component (`Button`) is a different component entirely. What a
 * design can't hold (callbacks, refs, React-node slots) stays out; inherited
 * base props sit behind a count, since a Mantine component inherits dozens.
 */
export function RepoPropFields({
  props,
  values,
  hidden,
  fieldKey,
  onChange,
}: {
  props: RepoPropDescriptor[];
  values: Record<string, unknown> | undefined;
  hidden: ReadonlySet<string>;
  fieldKey: string;
  onChange(name: string, value: unknown): void;
}) {
  const [showInherited, setShowInherited] = useState(false);
  const editable = props.filter((p) => p.serializable && !p.slot && !hidden.has(p.name));
  const own = editable.filter((p) => !p.inherited);
  const inherited = editable.filter((p) => p.inherited);
  if (editable.length === 0) return null;

  const field = (p: RepoPropDescriptor) => (
    <PropField
      key={`${fieldKey}:${p.name}`}
      descriptor={p}
      initialValue={values?.[p.name]}
      onChange={(v) => onChange(p.name, v)}
    />
  );

  return (
    <section className="flex flex-col gap-3" data-repo-props="">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Props</div>
      {own.map(field)}
      {inherited.length > 0 ? (
        <Collapsible open={showInherited} onOpenChange={setShowInherited}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight
              size={12}
              className={`transition-transform ${showInherited ? "rotate-90" : ""}`}
            />
            {inherited.length} inherited prop{inherited.length === 1 ? "" : "s"}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 flex flex-col gap-3">
            {inherited.map(field)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
