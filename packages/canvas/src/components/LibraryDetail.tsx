import type { ComponentDescriptor, PropDescriptor } from "@velloo/provider";
import type { SnippetParam } from "@velloo/schema";
import { PanelsTopLeft } from "lucide-react";
import { useMemo } from "react";
import type { SnippetMeta } from "../api.ts";
import { categoryForComponent } from "../library-categories.ts";
import { formatParamDefault } from "../snippet-params.ts";
import { type LibraryItemRef, useCanvas } from "../store.ts";
import { BackButton, DetailBreadcrumb } from "./LibraryDetailChrome.tsx";
import { RepoDetail } from "./RepoDetail.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";

interface Props {
  item: LibraryItemRef;
  snippets: SnippetMeta[];
}

/**
 * Component / snippet detail page. Sticky header carries the
 * breadcrumb, name, source, description. Below it: a hero preview, a
 * variants matrix (variant × size when both enums exist; just variants
 * row when only variant exists; otherwise just the hero), and a props
 * table.
 */
export function LibraryDetail({ item, snippets }: Props) {
  if (item.kind === "snippet") {
    return <SnippetDetail item={item} snippets={snippets} />;
  }
  if (item.kind === "repo") return <RepoDetail id={item.id} />;
  return <ComponentDetail item={item} />;
}

function ComponentDetail({ item }: { item: LibraryItemRef }) {
  const components = useCanvas((s) => s.components);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const openLibrary = useCanvas((s) => s.openLibrary);

  const descriptor = useMemo<ComponentDescriptor | null>(() => {
    if (!components) return null;
    return components.find((c) => c.id === item.id) ?? null;
  }, [components, item.id]);

  const category = categoryForComponent(components, item.id) ?? "Components";
  const dark = designMode === "dark";
  const previewModeQs = dark ? "&mode=dark" : "";

  const variantProp = descriptor?.props.find((p) => p.name === "variant" && p.enumValues);
  const sizeProp = descriptor?.props.find((p) => p.name === "size" && p.enumValues);
  const variants = (variantProp?.enumValues ?? []) as string[];
  const sizes = (sizeProp?.enumValues ?? []) as string[];

  const renderUrl = (props?: Record<string, unknown>, opts?: { w?: number; h?: number }) => {
    const w = opts?.w ?? 480;
    const h = opts?.h ?? 180;
    const qs = props ? `&props=${encodeURIComponent(JSON.stringify(props))}` : "";
    return `/api/render/component/${encodeURIComponent(item.id)}?w=${w}&h=${h}&v=${themeVersion}${qs}${previewModeQs}`;
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-5xl flex flex-col">
        <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm border-b px-8 pt-4 pb-5">
          <BackButton onClick={() => openLibrary(null)} />
          <div className="mt-3">
            <DetailBreadcrumb category={category} name={item.id} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight">{item.id}</h1>
            {descriptor ? (
              <Badge variant="outline" className="text-[10px] font-mono uppercase tracking-wider">
                {descriptor.source}
              </Badge>
            ) : null}
            {descriptor?.designModeNotes ? (
              <span className="text-xs text-muted-foreground italic">
                {descriptor.designModeNotes}
              </span>
            ) : null}
          </div>
        </header>

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Preview
          </div>
          <Card className="py-0">
            <iframe
              src={renderUrl(undefined, { w: 720, h: 220 })}
              title={`${item.id} preview`}
              loading="lazy"
              className="block w-full h-[220px] border-0"
            />
          </Card>
        </section>

        {variants.length > 0 || sizes.length > 0 ? (
          <section className="px-8 pb-6 flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Variants
              </div>
              <div className="text-xs text-muted-foreground">
                {variants.length || 1} × {sizes.length || 1} ={" "}
                {(variants.length || 1) * (sizes.length || 1)} combinations
              </div>
            </div>
            <VariantsMatrix
              componentId={item.id}
              variants={variants}
              sizes={sizes}
              renderUrl={renderUrl}
            />
          </section>
        ) : null}

        {descriptor && descriptor.props.length > 0 ? (
          <section className="px-8 pb-10 flex flex-col gap-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Props
            </div>
            <PropsTable props={descriptor.props} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function VariantsMatrix({
  componentId,
  variants,
  sizes,
  renderUrl,
}: {
  componentId: string;
  variants: string[];
  sizes: string[];
  renderUrl: (props?: Record<string, unknown>, opts?: { w?: number; h?: number }) => string;
}) {
  const rows = variants.length > 0 ? variants : [null];
  const cols = sizes.length > 0 ? sizes : [null];

  return (
    <Card className="py-0">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow>
            <TableHead className="w-32 text-[10px] uppercase tracking-wider">
              {variants.length > 0 ? "variant" : ""}
            </TableHead>
            {cols.map((c, i) => (
              <TableHead
                key={c ?? `col-${i}`}
                className="text-center text-[10px] uppercase tracking-wider"
              >
                {c ?? "preview"}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, ri) => (
            <TableRow key={row ?? `row-${ri}`}>
              <TableCell className="w-32 font-mono text-xs">{row ?? ""}</TableCell>
              {cols.map((col, ci) => {
                const props: Record<string, unknown> = {};
                if (row !== null) props.variant = row;
                if (col !== null) props.size = col;
                return (
                  <TableCell key={`${row ?? ri}-${col ?? ci}`} className="p-3">
                    <iframe
                      src={renderUrl(props, { w: 280, h: 80 })}
                      title={`${componentId} ${row ?? ""} ${col ?? ""}`}
                      loading="lazy"
                      className="w-full h-[80px] border-0"
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function PropsTable({ props }: { props: PropDescriptor[] }) {
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
          {props.map((p) => (
            <TableRow key={p.name}>
              <TableCell className="w-32 py-3 align-top">
                <div className="font-mono text-xs font-medium">{p.name}</div>
                {p.optional ? (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">optional</div>
                ) : null}
              </TableCell>
              <TableCell className="flex flex-row flex-wrap items-center gap-1 py-3">
                {p.enumValues && p.enumValues.length > 0 ? (
                  p.enumValues.map((v) => (
                    <Badge key={String(v)} variant="outline" className="font-mono text-[10px]">
                      {String(v)}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    {p.control}
                  </Badge>
                )}
                {p.defaultValue ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    default: <span className="font-mono">{p.defaultValue}</span>
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function SnippetDetail({ item, snippets }: { item: LibraryItemRef; snippets: SnippetMeta[] }) {
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const openLibrary = useCanvas((s) => s.openLibrary);
  const openSnippetEditor = useCanvas((s) => s.openSnippetEditor);
  const meta = snippets.find((s) => s.id === item.id) ?? null;
  const dark = designMode === "dark";
  const previewModeQs = dark ? "&mode=dark" : "";

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto w-full max-w-5xl flex flex-col">
        <header className="sticky top-0 z-10 bg-background/85 backdrop-blur-sm border-b px-8 pt-4 pb-5">
          <BackButton onClick={() => openLibrary(null)} />
          <div className="mt-3">
            <DetailBreadcrumb category="Snippets" name={meta?.name ?? item.id} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight">{meta?.name ?? item.id}</h1>
            <Badge
              variant="outline"
              className="text-[10px] font-mono uppercase tracking-wider border-primary/40 text-primary"
            >
              snippet
            </Badge>
            {meta?.unused ? (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wider border-amber-500/40 text-amber-600 dark:text-amber-400"
                title="No screen reaches this snippet, directly or through another snippet — nothing renders it."
              >
                unused
              </Badge>
            ) : null}
            <div className="ml-auto">
              <Button size="sm" onClick={() => openSnippetEditor(item.id)}>
                <PanelsTopLeft />
                Open in canvas
              </Button>
            </div>
          </div>
          {meta ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>
                {meta.params.length} parameter{meta.params.length === 1 ? "" : "s"}
              </span>
              {meta.params.map((p) => (
                <ParamChip key={p.name} param={p} />
              ))}
            </div>
          ) : null}
        </header>

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Preview
          </div>
          <Card className="py-0">
            <iframe
              src={`/api/render/snippet/${encodeURIComponent(item.id)}?w=720&h=260&v=${themeVersion}${previewModeQs}`}
              title={`${item.id} preview`}
              loading="lazy"
              className="block w-full h-[260px] border-0"
            />
          </Card>
        </section>

        {meta && meta.params.length > 0 ? (
          <section className="px-8 pb-10 flex flex-col gap-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Parameters
            </div>
            <Card className="py-0">
              <Table>
                <TableHeader className="sr-only">
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Type</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meta.params.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="w-32 py-3 font-mono text-xs font-medium">
                        ${p.name}
                      </TableCell>
                      <TableCell className="flex flex-row flex-wrap items-center gap-1 py-3">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {p.type}
                        </Badge>
                        {formatParamDefault(p) === null ? (
                          <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                            required
                          </span>
                        ) : (
                          <span className="ml-2 text-xs text-muted-foreground">
                            default: <span className="font-mono">{formatParamDefault(p)}</span>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A param reads as `$name` wherever nothing is bound to it — the preview, the
 * body tree, here. The declared default rides along so the header says which
 * slots an instance has to fill and which already have an answer.
 */
function ParamChip({ param }: { param: SnippetParam }) {
  const preset = formatParamDefault(param);
  return (
    <Badge
      variant="outline"
      className="border-dashed font-mono text-[10px] text-muted-foreground"
      title={`${param.type}${preset === null ? " · required" : ""}`}
    >
      ${param.name}
      {preset === null ? null : <span className="opacity-70"> = {preset}</span>}
    </Badge>
  );
}
