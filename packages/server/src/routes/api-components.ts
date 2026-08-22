import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Manifest, type StyleChannel, styleChannelOf } from "@velloo/provider";
import { Hono } from "hono";
import type { MutationContext } from "../mutations/index.ts";

/**
 * Returns the prop manifest for the current design folder. Prefers the
 * on-disk `.design/manifest.json` (generated at init / library upgrade
 * via ts-morph against the folder's actual components). Falls back to
 * the active provider's bundled manifest if the folder hasn't generated
 * one yet — keeps the canvas working on folders that predate per-folder
 * manifest generation.
 */
async function loadManifestForCtx(ctx: MutationContext): Promise<Manifest> {
  const onDisk = join(ctx.folder.root, ".design", "manifest.json");
  try {
    const raw = await readFile(onDisk, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return ctx.provider.loadManifest();
  }
}

export interface ComponentsResponse {
  manifest: Manifest;
  /** The default library's native style channel — drives the inspector's editor. */
  styleChannel: StyleChannel;
  /** Per-library channels (multi-library folders), so the inspector edits a screen in its library's channel. */
  channelsByLibrary: Record<string, StyleChannel>;
}

export function createComponentsRouter(ctxFor: () => MutationContext): Hono {
  const r = new Hono();

  r.get("/", async (c) => {
    const ctx = ctxFor();
    const manifest = await loadManifestForCtx(ctx);
    // Resolve each library's channel against the folder's CSS framework so a
    // none/none folder reports the inline-`style` channel (not Tailwind) — that
    // drives the inspector's editor + the agent's set_style shape.
    const css = ctx.folder.config.styling?.framework;
    const channelsByLibrary: Record<string, StyleChannel> = {};
    for (const [id, provider] of Object.entries(ctx.providers)) {
      channelsByLibrary[id] = styleChannelOf(provider, css);
    }
    const body: ComponentsResponse = {
      manifest,
      styleChannel: styleChannelOf(ctx.defaultProvider, css),
      channelsByLibrary,
    };
    return c.json(body);
  });

  return r;
}
