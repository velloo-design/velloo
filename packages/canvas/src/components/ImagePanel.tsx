import { assetPathFromSrc } from "@velloo/schema";
import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  deleteAsset,
  fetchIntents,
  type GeneratedAsset,
  generateAsset,
  type IntentPrice,
  mutate,
} from "../api.ts";
import { pathFromString } from "../path.ts";
import { useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Textarea } from "./ui/textarea.tsx";

/**
 * The image panel: what a generated image knows about itself, and how to
 * re-roll it without leaving the canvas.
 *
 * A generated image is the only asset whose *source* is invisible once it's on
 * the board — the prompt that made it lived in an agent transcript. Selecting
 * one here shows that prompt, lets it be rewritten, and regenerates in place.
 * An image velloo didn't generate gets the same panel with an empty prompt, so
 * "replace this placeholder with real art" is one action rather than a trip
 * through the agent.
 *
 * Regenerating writes a NEW asset and repoints the node's `src` through the
 * normal prop mutation. Overwriting the file in place would be undoable only
 * outside velloo's history and would leave every other node using that asset
 * silently changed; this way a re-roll is one undo away and touches one node.
 */

/** Intents that make sense for "an image in a design", in the order offered. */
const INTENTS = [
  { id: "illustration", label: "Illustration", hint: "Spot art, empty states, editorial" },
  { id: "photo", label: "Photo", hint: "Realistic marketing, product, hero" },
  { id: "graphic", label: "Graphic", hint: "Layouts with legible text" },
  { id: "texture", label: "Texture", hint: "Backgrounds, gradients, patterns" },
  { id: "icon", label: "Icon", hint: "One pictogram, transparent" },
  { id: "vector", label: "Vector (SVG)", hint: "Illustrative logos and spot vectors" },
  { id: "mark", label: "Mark (SVG)", hint: "Flat geometric shapes — cheapest SVG" },
] as const;

const ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"] as const;

/** Aspect whose shape best matches a generated raster's real dimensions. */
function aspectForSize(width?: number, height?: number): string | undefined {
  if (!width || !height) return undefined;
  const ratio = width / height;
  let best: string | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const a of ASPECTS) {
    const [w, h] = a.split(":").map(Number) as [number, number];
    const delta = Math.abs(ratio - w / h);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = a;
    }
  }
  return best;
}

/**
 * `<Image aspect>` accepts a narrower set than the generator does. An aspect
 * outside this map (21/9, or a generation-only 3:2) has no counterpart, and
 * the two directions are used to keep the panel's aspect and the node's layout
 * aspect in agreement — see `nodeAspect` on the props.
 */
const IMAGE_ASPECT_PROP: Record<string, string> = {
  "1:1": "1/1",
  "4:3": "4/3",
  "3:4": "3/4",
  "16:9": "16/9",
};
const ASPECT_FROM_PROP: Record<string, string> = Object.fromEntries(
  Object.entries(IMAGE_ASPECT_PROP).map(([a, p]) => [p, a]),
);

/**
 * The aspect the control should show: what actually generated the image, else
 * the shape the node lays out at, else the pixels, else square.
 */
function seedAspect(
  rec: { aspect?: string; width?: number; height?: number } | undefined,
  nodeAspect: string | undefined,
): string {
  return (
    rec?.aspect ??
    ASPECT_FROM_PROP[nodeAspect ?? ""] ??
    aspectForSize(rec?.width, rec?.height) ??
    "1:1"
  );
}

/** "$0.04" — the unit the picker is choosing between, so cents always show. */
function priceLabel(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

/**
 * Every other version of this image, newest first.
 *
 * Provenance links each generation to the one it replaced, so the versions of
 * an image form a chain — but restoring an older one and re-rolling from there
 * branches it. Walking the `replaces` edges as an UNDIRECTED graph keeps the
 * whole family reachable from whichever member is currently on the node;
 * following the chain backwards only would make everything newer than the
 * current pick vanish the moment you restored an older one.
 *
 * The far end of the chain is usually an asset with no record of its own — the
 * uploaded image the first generation replaced. It belongs in the list: going
 * back to the original is the most likely reason to open this at all.
 */
function lineageOf(records: Record<string, GeneratedAsset>, current: string): string[] {
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)?.add(b);
    edges.get(b)?.add(a);
  };
  for (const [path, rec] of Object.entries(records)) if (rec.replaces) link(path, rec.replaces);

  const seen = new Set([current]);
  const queue = [current];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    for (const neighbour of edges.get(next) ?? []) {
      if (!seen.has(neighbour)) {
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  seen.delete(current);
  return [...seen].sort((a, b) =>
    (records[b]?.generatedAt ?? "").localeCompare(records[a]?.generatedAt ?? ""),
  );
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

interface Props {
  screenId: string;
  path: string;
  /** The node's current `src` prop. */
  src: string;
  /**
   * The node's `aspect` prop, if any. It seeds the aspect control so the shape
   * we generate matches the shape the node lays out at: otherwise a user who
   * picks 16:9 on a node styled `1/1` gets a wide image silently cropped
   * square, with nothing on screen explaining why.
   */
  nodeAspect?: string;
}

export function ImagePanel({ screenId, path, src, nodeAspect }: Props) {
  const generatedAssets = useCanvas((s) => s.generatedAssets);
  const loadGeneratedAssets = useCanvas((s) => s.loadGeneratedAssets);

  const assetPath = assetPathFromSrc(src);
  const record = assetPath ? generatedAssets[assetPath] : undefined;

  const [prompt, setPrompt] = useState(record?.prompt ?? "");
  const [intent, setIntent] = useState<string>(record?.intent ?? "illustration");
  const [aspect, setAspect] = useState<string>(() => seedAspect(record, nodeAspect));
  const [busy, setBusy] = useState(false);
  // Priced live from the cloud on every mount, so a repricing on the server
  // reaches the picker on the next image you select rather than the next
  // velloo release. An empty list simply means no prices to show.
  const [prices, setPrices] = useState<IntentPrice[]>([]);
  // A non-generated image starts collapsed: most selections are just "what is
  // this node", and an unbidden prompt box would imply the image is editable
  // when it isn't yet.
  const [composing, setComposing] = useState(false);

  /**
   * Which asset the draft above belongs to. Generating repoints `src`, and the
   * new asset's provenance and the node's new src arrive from two independent
   * sources (the assets fetch and the screen's WS refresh) — so a plain
   * "re-seed whenever the record changes" effect would briefly see a new src
   * with no record yet and collapse the panel back to "not generated", right
   * after the user watched it generate.
   */
  const seededFrom = useRef<string | null>(assetPath);

  useEffect(() => {
    const key = assetPath ?? "";
    const rec = key ? generatedAssets[key] : undefined;
    if (seededFrom.current !== key) {
      // The selection moved to a different image — adopt its prompt.
      seededFrom.current = key;
      setPrompt(rec?.prompt ?? "");
      setIntent(rec?.intent ?? "illustration");
      setAspect(seedAspect(rec, nodeAspect));
      setComposing(false);
    } else if (rec && prompt === "") {
      // Provenance is fetched async, so it can land after the panel mounts.
      // Fill an untouched prompt rather than leaving a generated image
      // presenting itself as an uploaded one.
      setPrompt(rec.prompt);
      setIntent(rec.intent);
      setAspect(seedAspect(rec, nodeAspect));
    }
  }, [assetPath, generatedAssets, prompt, nodeAspect]);

  useEffect(() => {
    let live = true;
    fetchIntents()
      .then((list) => live && setPrices(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const priceOf = (id: string) => prices.find((p) => p.intent === id)?.priceMicros;
  // The curated order and labels stay local — the catalogue includes intents
  // that need a source image (edit/cutout/upscale), which this panel doesn't
  // offer. But an intent the server has withdrawn drops out on its own.
  const offered = INTENTS.filter((i) => prices.length === 0 || priceOf(i.id) !== undefined);
  const intentLabel = INTENTS.find((i) => i.id === intent)?.label ?? intent;

  const svgIntent = intent === "vector" || intent === "mark";

  const run = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const result = await generateAsset({
        prompt: trimmed,
        intent,
        // SVG intents render at their own viewBox; sending an aspect would be
        // a knob the catalogue ignores for `mark` anyway.
        ...(svgIntent ? {} : { aspect }),
        ...(assetPath ? { replaces: assetPath } : {}),
      });
      const propPatch: Record<string, unknown> = { src: result.url };
      // Point the node at the new file AND size it: `<Image>` fills its parent,
      // so a src swap alone can leave the image laying out at zero height.
      // The control was seeded from the node's own aspect, so writing it back
      // is a no-op unless the user deliberately changed the shape — except
      // when the node carries an aspect we can't represent (21/9), where the
      // author's layout choice stands.
      const nodeAspectIsOurs = !nodeAspect || nodeAspect in ASPECT_FROM_PROP;
      const imageAspect =
        IMAGE_ASPECT_PROP[aspectForSize(result.width, result.height) ?? ""] ??
        (svgIntent ? undefined : IMAGE_ASPECT_PROP[aspect]);
      if (nodeAspectIsOurs && imageAspect) propPatch.aspect = imageAspect;
      // Claim the new asset before its src or provenance can reach the store,
      // so the re-seed effect treats this draft as already belonging to it.
      seededFrom.current = result.assetPath;
      await mutate.updateProps({ screenId, path: pathFromString(path), propPatch });
      await loadGeneratedAssets();
      pushToast({ kind: "success", title: "Image generated", message: result.cost });
    } catch (err) {
      toastError(err, "Could not generate the image");
    } finally {
      setBusy(false);
    }
  };

  /** Point the node back at an earlier version. Undoable like any prop edit. */
  const restore = async (version: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const rec = generatedAssets[version];
      const propPatch: Record<string, unknown> = { src: `/${version}` };
      const restoredAspect = IMAGE_ASPECT_PROP[aspectForSize(rec?.width, rec?.height) ?? ""];
      // Sizing follows the image being restored — an older version at a
      // different shape would otherwise be cropped to the current one's.
      if (restoredAspect && (!nodeAspect || nodeAspect in ASPECT_FROM_PROP)) {
        propPatch.aspect = restoredAspect;
      }
      // Claim it before the src reaches the store, exactly as generating does,
      // so the re-seed effect adopts this draft rather than resetting it.
      seededFrom.current = version;
      setPrompt(rec?.prompt ?? "");
      setIntent(rec?.intent ?? "illustration");
      setComposing(false);
      await mutate.updateProps({ screenId, path: pathFromString(path), propPatch });
    } catch (err) {
      toastError(err, "Could not restore that version");
    } finally {
      setBusy(false);
    }
  };

  /** Delete a version for good. The server refuses while anything still uses it. */
  const forget = async (version: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteAsset(version);
      await loadGeneratedAssets();
      pushToast({ kind: "success", message: `Deleted ${version.replace("assets/", "")}.` });
    } catch (err) {
      toastError(err, "Could not delete that image");
    } finally {
      setBusy(false);
    }
  };

  // An image pointing outside assets/ (a remote URL, a host-app path) can't be
  // regenerated in place — say so rather than offering a button that would
  // silently repoint it.
  if (!assetPath) {
    return (
      <section className="flex flex-col gap-1.5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Image</div>
        <p className="text-xs text-muted-foreground">
          This image isn't in the folder's <code>assets/</code> store, so it has no velloo
          provenance. Point <code>src</code> at an asset to generate a replacement.
        </p>
      </section>
    );
  }

  const collapsed = !record && !composing;
  const versions = lineageOf(generatedAssets, assetPath);

  return (
    <section className="flex flex-col gap-2" data-testid="image-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Image</div>
        {record ? (
          <span
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
            data-testid="image-panel-badge"
          >
            generated by velloo
          </span>
        ) : (
          <span
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
            data-testid="image-panel-badge"
          >
            not generated
          </span>
        )}
      </div>

      {collapsed ? (
        <>
          <p className="text-xs text-muted-foreground">
            velloo didn't generate this image, so there's no prompt to show.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            data-testid="image-panel-compose"
            onClick={() => setComposing(true)}
          >
            Replace with a generated image
          </Button>
        </>
      ) : (
        <>
          <Label htmlFor="image-prompt" className="text-xs font-medium text-muted-foreground">
            prompt
          </Label>
          <Textarea
            id="image-prompt"
            data-testid="image-panel-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Describe subject, style, lighting and mood — these models reward detail."
            className="min-h-0 text-xs"
          />

          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1.5">
              <Label htmlFor="image-intent" className="text-xs font-medium text-muted-foreground">
                intent
              </Label>
              <Select value={intent} onValueChange={setIntent}>
                <SelectTrigger id="image-intent" size="sm" className="text-xs">
                  {/* Children override the selected item's text: the price
                      belongs in the list, where you're comparing options, not
                      in the trigger, where it's just noise on every render. */}
                  <SelectValue>{intentLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {offered.map((i) => {
                    const micros = priceOf(i.id);
                    return (
                      // Radix wraps an item's children in an ItemText span,
                      // which is a shrink-to-fit flex item — so `w-full`
                      // inside it measures the text, not the row. Letting
                      // that span grow is what puts the prices in a column
                      // down the right edge instead of trailing each label.
                      <SelectItem key={i.id} value={i.id} className="[&>span:last-child]:flex-1">
                        <span className="flex items-center justify-between gap-4">
                          <span>{i.label}</span>
                          {micros === undefined ? null : (
                            <span className="text-muted-foreground tabular-nums">
                              {priceLabel(micros)}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {svgIntent ? null : (
              <div className="w-24 flex flex-col gap-1.5">
                <Label htmlFor="image-aspect" className="text-xs font-medium text-muted-foreground">
                  aspect
                </Label>
                <Select value={aspect} onValueChange={setAspect}>
                  <SelectTrigger id="image-aspect" size="sm" className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECTS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Button
            size="sm"
            className="text-xs"
            data-testid="image-panel-generate"
            disabled={busy || prompt.trim().length === 0}
            onClick={() => void run()}
          >
            {busy ? "Generating…" : record ? "Regenerate" : "Generate"}
          </Button>

          <p className="text-[10px] text-muted-foreground leading-relaxed">
            {record ? (
              <>
                {/* The intent, never the model: which checkpoint serves an
                    intent is the cloud's to change, and naming it here would
                    invite depending on it. */}
                {record.intent}
                {` · ${relativeAge(record.generatedAt)}`}
                {record.width && record.height ? ` · ${record.width}×${record.height}` : null}
                <br />
              </>
            ) : null}
            Charged against your velloo-cloud credits. Each run makes a new asset and repoints this
            node.
          </p>
        </>
      )}

      {versions.length > 0 ? (
        <div className="flex flex-col gap-1.5 pt-1" data-testid="image-panel-history">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Previous versions
          </div>
          {versions.map((version) => {
            const rec = generatedAssets[version];
            return (
              <div
                key={version}
                className="flex items-center gap-2"
                data-testid="image-panel-version"
                data-version={version}
              >
                <img
                  src={`/${version}`}
                  alt=""
                  className="size-8 shrink-0 rounded border object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  {rec ? `${rec.intent} · ${relativeAge(rec.generatedAt)}` : "original"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Put this version back on the node"
                  data-testid="image-panel-restore"
                  disabled={busy}
                  onClick={() => void restore(version)}
                >
                  <RotateCcw className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  title="Delete this version for good"
                  data-testid="image-panel-delete"
                  disabled={busy}
                  onClick={() => void forget(version)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
