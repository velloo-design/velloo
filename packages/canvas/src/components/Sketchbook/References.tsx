import {
  type ReferencePatch,
  SKETCHBOOK_LIMITS,
  type SketchbookPageOption,
} from "@velloo/protocol";
import type { SketchbookDirection, SketchbookReference } from "@velloo/schema";
import { Globe, ImagePlus, Trash2 } from "lucide-react";
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { sketchbook as sketchbookApi } from "../../api/sketchbook.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.tsx";

/**
 * Screenshots the person likes, which directions are drawn from: dropped,
 * pasted or picked from disk on the start page, or a page the daemon
 * screenshots from its URL. They cost nothing; a direction that names one
 * sends it to the image model.
 */

const NONE: SketchbookReference[] = [];

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** What a reference is called on its card: its note's page, or its file. */
const referenceLabel = (r: SketchbookReference) => (r.url ? hostOf(r.url) : r.id);

/** Read the images among `files` as data URLs, saying which ones aren't images. */
function readImages(files: Iterable<File>, onData: (data: string) => void) {
  for (const file of files) {
    if (!IMAGE_TYPES.includes(file.type)) {
      toastError(new Error(`${file.name} isn't a PNG, JPEG, WebP or GIF image.`), "Not an image");
      continue;
    }
    void readAsDataUrl(file)
      .then(onData)
      .catch((err) => toastError(err, "Could not read the image"));
  }
}

/** The captured pages the URL field offers, as the start page lists them. */
function useCapturedPages(): SketchbookPageOption[] {
  const [pages, setPages] = useState<SketchbookPageOption[]>([]);
  useEffect(() => {
    let live = true;
    void sketchbookApi
      .pages()
      .then((r) => live && setPages(r.pages.filter((p) => p.kind === "capture" && p.detail)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return pages;
}

/**
 * Where references are added: dropped or pasted anywhere on it, picked from
 * disk, or a page given by its address. `children` are the ones added.
 */
function ReferenceDrop({
  intro,
  adding,
  onUrl,
  onFiles,
  children,
}: {
  intro: string;
  adding: boolean;
  /** Resolves true once the page is added, to clear the field. */
  onUrl: (href: string) => Promise<boolean>;
  onFiles: (files: Iterable<File>) => void;
  children: ReactNode;
}) {
  const [url, setUrl] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const captured = useCapturedPages();
  const submitUrl = () => {
    const target = url.trim();
    if (!target) return;
    const href = /^https?:\/\//i.test(target) ? target : `https://${target}`;
    void onUrl(href).then((done) => done && setUrl(""));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(e.dataTransfer.files);
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => IMAGE_TYPES.includes(f.type));
    if (files.length === 0) return;
    e.preventDefault();
    onFiles(files);
  };
  return (
    <section
      data-sketchbook-references
      aria-label="References"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      className={`flex flex-col gap-3 rounded-lg border border-dashed p-3 ${over ? "border-primary bg-primary/5" : ""}`}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">
          References <span className="font-normal text-muted-foreground">(optional)</span>
        </h2>
        <p className="text-xs text-muted-foreground">{intro}</p>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-8 min-w-64 flex-1">
          <InputGroupAddon>
            <Globe />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="A page's address"
            placeholder="https://a-site-you-like.com"
            list="sketchbook-captured-pages"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitUrl();
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton disabled={!url.trim() || adding} onClick={submitUrl}>
              Add page
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <datalist id="sketchbook-captured-pages">
          {captured.map((p) => (
            <option key={p.page.captureId} value={p.detail}>
              {p.page.label}
            </option>
          ))}
        </datalist>
        <Button
          size="sm"
          variant="outline"
          disabled={adding}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus />
          Upload screenshot
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </section>
  );
}

/** A reference picked before the sketchbook exists: added to it when it starts. */
export interface DraftReference {
  key: string;
  url?: string;
  /** An uploaded screenshot, as a data URL. */
  data?: string;
  note: string;
}

/** What the sketchbook is sent for the references picked on its start page. */
export const draftPatches = (drafts: DraftReference[]): ReferencePatch[] =>
  drafts.map((d) => ({
    ...(d.url ? { url: d.url } : {}),
    ...(d.data ? { data: d.data } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  }));

/** As many as one update of a sketchbook takes. */
const MAX_DRAFTS = 12;

let draftCount = 0;

function DraftCard({
  draft,
  onNote,
  onRemove,
}: {
  draft: DraftReference;
  onNote: (note: string) => void;
  onRemove: () => void;
}) {
  const label = draft.url ? hostOf(draft.url) : "Screenshot";
  return (
    <div data-draft-reference={draft.key} className="flex flex-col gap-1.5">
      <div className="relative aspect-[3/2] overflow-hidden rounded-md border bg-muted">
        {draft.data ? (
          <img src={draft.data} alt="" className="size-full object-cover object-top" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-[11px] text-muted-foreground">
            <Globe className="size-4" aria-hidden />
            Screenshot taken when you start
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={draft.url}>
          {label}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Remove this reference"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <Input
        className="h-7 text-xs"
        aria-label="What to take from it"
        placeholder="What to take from it"
        maxLength={SKETCHBOOK_LIMITS.note}
        value={draft.note}
        onChange={(e) => onNote(e.target.value)}
      />
    </div>
  );
}

/**
 * References picked on a start page, before there is a sketchbook to add
 * them to: kept here and sent with it when it starts (`draftPatches`).
 */
export function DraftReferences({
  value,
  onChange,
}: {
  value: DraftReference[];
  onChange: (next: (prev: DraftReference[]) => DraftReference[]) => void;
}) {
  const push = (draft: Omit<DraftReference, "key" | "note">) =>
    onChange((prev) =>
      prev.length >= MAX_DRAFTS
        ? prev
        : [...prev, { ...draft, key: `draft-${++draftCount}`, note: "" }],
    );
  const full = value.length >= MAX_DRAFTS;
  return (
    <ReferenceDrop
      intro="Sites you'd like it to feel like. Drop or paste a screenshot, or give a page's address; say what to take from each. Your agent draws directions from them. They cost nothing."
      adding={full}
      onUrl={async (url) => {
        push({ url });
        return true;
      }}
      onFiles={(files) => readImages(files, (data) => push({ data }))}
    >
      {value.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {value.map((d) => (
            <DraftCard
              key={d.key}
              draft={d}
              onNote={(note) =>
                onChange((prev) => prev.map((p) => (p.key === d.key ? { ...p, note } : p)))
              }
              onRemove={() => onChange((prev) => prev.filter((p) => p.key !== d.key))}
            />
          ))}
        </div>
      ) : null}
    </ReferenceDrop>
  );
}

/** Which references a direction is drawn from: each toggles, up to three. */
export function DirectionReferences({ direction }: { direction: SketchbookDirection }) {
  const references = useCanvas((s) => s.sketchbook?.sketchbook.references ?? NONE);
  const update = useCanvas((s) => s.updateSketchbook);
  if (references.length === 0) return null;
  const toggle = (id: string) => {
    const on = direction.references.includes(id);
    const next = on ? direction.references.filter((r) => r !== id) : [...direction.references, id];
    void update({ directions: [{ id: direction.id, references: next }] }).catch((err) =>
      toastError(err, "Could not change the references"),
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">Drawn from</span>
      <div className="flex flex-wrap gap-1.5">
        {references.map((r) => {
          const on = direction.references.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              disabled={!on && direction.references.length >= 3}
              title={r.note ? `${referenceLabel(r)}: ${r.note}` : referenceLabel(r)}
              onClick={() => toggle(r.id)}
              className={`h-10 w-14 overflow-hidden rounded border bg-muted disabled:opacity-40 ${on ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : "opacity-60 hover:opacity-100"}`}
            >
              <img
                src={`/${r.path}`}
                alt={referenceLabel(r)}
                className="size-full object-cover object-top"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
