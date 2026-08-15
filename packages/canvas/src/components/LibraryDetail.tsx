import type { ComponentDescriptor, PropDescriptor } from "@velloo/shadcn-snapshot";
import { ArrowLeft, LibraryBig } from "lucide-react";
import { useMemo } from "react";
import type { SnippetMeta } from "../api.ts";
import { categoryForComponent } from "../library-categories.ts";
import { type LibraryItemRef, useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Breadcrumb as UIBreadcrumb,
} from "./ui/breadcrumb.tsx";
import { Button } from "./ui/button.tsx";

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

  const category = categoryForComponent(item.id) ?? "Components";
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
          <div className="rounded-lg border bg-card overflow-hidden">
            <iframe
              src={renderUrl(undefined, { w: 720, h: 220 })}
              title={`${item.id} preview`}
              loading="lazy"
              className="block w-full h-[220px] border-0"
            />
          </div>
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
    <div className="rounded-lg border bg-card overflow-hidden">
      <div
        className="grid border-b bg-muted/30"
        style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}
      >
        <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {variants.length > 0 ? "variant" : ""}
        </div>
        {cols.map((c, i) => (
          <div
            key={c ?? `col-${i}`}
            className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-center"
          >
            {c ?? "preview"}
          </div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div
          key={row ?? `row-${ri}`}
          className={`grid items-center ${ri < rows.length - 1 ? "border-b" : ""}`}
          style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}
        >
          <div className="px-4 py-2 text-xs font-mono">{row ?? ""}</div>
          {cols.map((col, ci) => {
            const props: Record<string, unknown> = {};
            if (row !== null) props.variant = row;
            if (col !== null) props.size = col;
            return (
              <div
                key={`${row ?? ri}-${col ?? ci}`}
                className="p-3 flex items-center justify-center"
              >
                <iframe
                  src={renderUrl(props, { w: 280, h: 80 })}
                  title={`${componentId} ${row ?? ""} ${col ?? ""}`}
                  loading="lazy"
                  className="w-full h-[80px] border-0"
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PropsTable({ props }: { props: PropDescriptor[] }) {
  return (
    <div className="rounded-lg border bg-card divide-y">
      {props.map((p) => (
        <div key={p.name} className="px-4 py-3 flex items-start gap-4">
          <div className="w-32 shrink-0">
            <div className="text-xs font-mono font-medium">{p.name}</div>
            {p.optional ? (
              <div className="text-[10px] text-muted-foreground mt-0.5">optional</div>
            ) : null}
          </div>
          <div className="flex-1 flex flex-row flex-wrap gap-1 items-center">
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
              <span className="text-xs text-muted-foreground ml-2">
                default: <span className="font-mono">{p.defaultValue}</span>
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function SnippetDetail({ item, snippets }: { item: LibraryItemRef; snippets: SnippetMeta[] }) {
  const themeVersion = useCanvas((s) => s.themeVersion);
  const designMode = useCanvas((s) => s.designMode);
  const openLibrary = useCanvas((s) => s.openLibrary);
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
          </div>
          {meta ? (
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              {meta.params.length} parameter{meta.params.length === 1 ? "" : "s"}
              {meta.params.length > 0 ? ` · ${meta.params.map((p) => p.name).join(", ")}` : ""}
            </p>
          ) : null}
        </header>

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Preview
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            <iframe
              src={`/api/render/snippet/${encodeURIComponent(item.id)}?w=720&h=260&v=${themeVersion}${previewModeQs}`}
              title={`${item.id} preview`}
              loading="lazy"
              className="block w-full h-[260px] border-0"
            />
          </div>
        </section>

        {meta && meta.params.length > 0 ? (
          <section className="px-8 pb-10 flex flex-col gap-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Parameters
            </div>
            <div className="rounded-lg border bg-card divide-y">
              {meta.params.map((p) => (
                <div key={p.name} className="px-4 py-3 flex items-start gap-4">
                  <div className="w-32 shrink-0">
                    <div className="text-xs font-mono font-medium">{p.name}</div>
                  </div>
                  <div className="flex-1 flex flex-row flex-wrap gap-1 items-center">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {p.type}
                    </Badge>
                    {p.default !== undefined ? (
                      <span className="text-xs text-muted-foreground ml-2">
                        default: <span className="font-mono">{JSON.stringify(p.default)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function DetailBreadcrumb({ category, name }: { category: string; name: string }) {
  return (
    <UIBreadcrumb>
      <BreadcrumbList className="text-xs">
        <BreadcrumbItem>
          <LibraryBig size={12} strokeWidth={2} />
          <BreadcrumbLink href="#">Library</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <span>{category}</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </UIBreadcrumb>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="-ml-2 text-muted-foreground">
      <ArrowLeft />
      Library
    </Button>
  );
}
