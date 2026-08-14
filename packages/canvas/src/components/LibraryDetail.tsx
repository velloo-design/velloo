import type { ComponentDescriptor, PropDescriptor } from "@velloo/shadcn-snapshot";
import { ArrowLeft, ChevronRight, LibraryBig } from "lucide-react";
import { useMemo } from "react";
import type { SnippetMeta } from "../api.ts";
import { categoryForComponent } from "../library-categories.ts";
import { type LibraryItemRef, useCanvas } from "../store.ts";

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
    <div className="flex-1 overflow-auto bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-5xl flex flex-col">
        <header className="sticky top-0 z-10 bg-[var(--color-bg)]/85 backdrop-blur-sm border-b border-[var(--color-border)] px-8 pt-4 pb-5">
          <BackButton onClick={() => openLibrary(null)} />
          <div className="mt-3">
            <Breadcrumb category={category} name={item.id} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
              {item.id}
            </h1>
            {descriptor ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-fg-muted)] uppercase tracking-wider">
                {descriptor.source}
              </span>
            ) : null}
            {descriptor?.designModeNotes ? (
              <span className="text-xs text-[var(--color-fg-muted)] italic">
                {descriptor.designModeNotes}
              </span>
            ) : null}
          </div>
        </header>

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
            Preview
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
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
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
                Variants
              </div>
              <div className="text-xs text-[var(--color-fg-muted)]">
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
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
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
  // Normalize: at least one row, at least one column.
  const rows = variants.length > 0 ? variants : [null];
  const cols = sizes.length > 0 ? sizes : [null];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div
        className="grid border-b border-[var(--color-border)] bg-[var(--color-bg)]"
        style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}
      >
        <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
          {variants.length > 0 ? "variant" : ""}
        </div>
        {cols.map((c, i) => (
          <div
            key={c ?? `col-${i}`}
            className="px-4 py-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium text-center"
          >
            {c ?? "preview"}
          </div>
        ))}
      </div>
      {rows.map((row, ri) => (
        <div
          key={row ?? `row-${ri}`}
          className={
            "grid items-center " +
            (ri < rows.length - 1 ? "border-b border-[var(--color-border)]" : "")
          }
          style={{ gridTemplateColumns: `120px repeat(${cols.length}, 1fr)` }}
        >
          <div className="px-4 py-2 text-xs font-mono text-[var(--color-fg)]">{row ?? ""}</div>
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
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
      {props.map((p) => (
        <div key={p.name} className="px-4 py-3 flex items-start gap-4">
          <div className="w-32 shrink-0">
            <div className="text-xs font-mono font-medium text-[var(--color-fg)]">{p.name}</div>
            {p.optional ? (
              <div className="text-[10px] text-[var(--color-fg-muted)] mt-0.5">optional</div>
            ) : null}
          </div>
          <div className="flex-1 flex flex-row flex-wrap gap-1 items-center">
            {p.enumValues && p.enumValues.length > 0 ? (
              p.enumValues.map((v) => (
                <span
                  key={String(v)}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-fg)]"
                >
                  {String(v)}
                </span>
              ))
            ) : (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-fg-muted)]">
                {p.control}
              </span>
            )}
            {p.defaultValue ? (
              <span className="text-xs text-[var(--color-fg-muted)] ml-2">
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
    <div className="flex-1 overflow-auto bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-5xl flex flex-col">
        <header className="sticky top-0 z-10 bg-[var(--color-bg)]/85 backdrop-blur-sm border-b border-[var(--color-border)] px-8 pt-4 pb-5">
          <BackButton onClick={() => openLibrary(null)} />
          <div className="mt-3">
            <Breadcrumb category="Snippets" name={meta?.name ?? item.id} />
          </div>
          <div className="mt-2 flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
              {meta?.name ?? item.id}
            </h1>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-accent)]/40 text-[var(--color-accent)] uppercase tracking-wider">
              snippet
            </span>
          </div>
          {meta ? (
            <p className="mt-1 text-sm text-[var(--color-fg-muted)] max-w-xl">
              {meta.params.length} parameter{meta.params.length === 1 ? "" : "s"}
              {meta.params.length > 0 ? ` · ${meta.params.map((p) => p.name).join(", ")}` : ""}
            </p>
          ) : null}
        </header>

        <section className="px-8 py-6 flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
            Preview
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
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
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] font-medium">
              Parameters
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
              {meta.params.map((p) => (
                <div key={p.name} className="px-4 py-3 flex items-start gap-4">
                  <div className="w-32 shrink-0">
                    <div className="text-xs font-mono font-medium text-[var(--color-fg)]">
                      {p.name}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-row flex-wrap gap-1 items-center">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-fg)]">
                      {p.type}
                    </span>
                    {p.default !== undefined ? (
                      <span className="text-xs text-[var(--color-fg-muted)] ml-2">
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

function Breadcrumb({ category, name }: { category: string; name: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
      <LibraryBig size={12} strokeWidth={2} />
      <span>Library</span>
      <ChevronRight size={10} strokeWidth={2} className="opacity-60" />
      <span>{category}</span>
      <ChevronRight size={10} strokeWidth={2} className="opacity-60" />
      <span className="text-[var(--color-fg)]">{name}</span>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-7 px-2 -ml-2 rounded-md text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg)] transition-colors"
    >
      <ArrowLeft size={13} strokeWidth={2} />
      Library
    </button>
  );
}
