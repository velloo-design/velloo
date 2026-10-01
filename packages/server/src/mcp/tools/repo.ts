import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { probeCanvasMount } from "@velloo/renderer";
import { type ComponentNode, repoKey, type Screen } from "@velloo/schema";
import { z } from "zod";
import { themeByName } from "../../design-folder.ts";
import type { CanvasBundler } from "../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../live/component-bundler.ts";
import type { MutationContext } from "../../mutations/index.ts";
import type { RepoCatalogEntry } from "../../repo/catalog.ts";
import { previewFileCandidates } from "../../repo/preview.ts";
import { pickProbe, probeVerdict } from "../../repo/preview-probe.ts";
import {
  entryStylesheets,
  type UnloadedStylesheet,
  type UnprocessedStylesheet,
  unloadedAppStylesheets,
  unprocessedStylesheets,
} from "../../repo/preview-styles.ts";
import { suggestPreviewEntry } from "../../repo/suggest-preview.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { errorResult, jsonResult } from "./result.ts";
import {
  browserErrorMessage,
  defaultViewport,
  makeCanvasBundle,
  makeLiveUrl,
  recordMount,
  renderForCapture,
} from "./screenshot-helpers.ts";

const MAX_PREVIEW_BYTES = 100_000;

/**
 * The setup loop for an app's own components: `preview_status` says whether
 * the preview entry (providers + global CSS) is in place and proves it by
 * mounting a real component; `set_preview_entry` writes one and re-probes.
 * Together they replace an init-time scan with one guided agent step.
 */
export function registerRepoTools(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  assetOrigin?: string,
): void {
  const status = async (app: string | undefined, component: string | undefined, probe: boolean) => {
    if (!ctx.repo)
      return errorResult({
        kind: "BadRequest",
        message: "This session has no repository-component catalog.",
      });
    const catalog = await ctx.repo.catalog();
    const summary = catalog.apps.find((entry) => (entry.app ?? undefined) === app);
    if (!summary) {
      return errorResult({
        kind: "BadRequest",
        message: `No host app ${JSON.stringify(app)} — see config.hostApps.`,
      });
    }
    const preview = ctx.repo.preview(app);
    const target = pickProbe(catalog, app, component);
    let probeResult: Record<string, unknown> | undefined;
    let state: "absent" | "valid" | "failing" = preview.kind === "none" ? "absent" : "valid";
    if (probe && target) {
      try {
        const outcome = await runProbe(ctx, jit, bundler, canvasBundler, target, assetOrigin);
        const own = outcome.diagnostics.find((entry) => entry.id === target.key);
        const wrapperError = outcome.diagnostics.find((entry) => entry.id === "preview");
        const dropped = target.states[0]?.dropped ?? [];
        const { state: verdict, inconclusive } = probeVerdict({
          prior: state,
          mounted: outcome.mounted,
          ownStatus: own?.status,
          ownCode: own?.code,
          wrapperError: wrapperError !== undefined,
          dropped,
        });
        state = verdict;
        probeResult = {
          component: target.id,
          mounted: outcome.mounted,
          ...(own
            ? {
                status: own.status,
                ...(own.code ? { code: own.code } : {}),
                ...(own.note ? { note: own.note } : {}),
                ...(own.remedy ? { remedy: own.remedy } : {}),
              }
            : {}),
          ...(wrapperError ? { previewError: wrapperError.note } : {}),
          ...(inconclusive
            ? {
                inconclusive: `${target.id} was mounted without ${dropped.map((name) => `\`${name}\``).join(", ")}, which the app passes as code, and it threw on that — it says nothing about the preview entry. Probe another component with preview_status { component } to check the entry.`,
              }
            : {}),
          ...(outcome.consoleErrors.length > 0
            ? { consoleErrors: outcome.consoleErrors.slice(0, 5) }
            : {}),
        };
      } catch (error) {
        const message =
          browserErrorMessage(error) ?? (error instanceof Error ? error.message : String(error));
        probeResult = { component: target.id, skipped: message };
      }
    }
    // A clean mount says the providers are right, not that the app's own CSS
    // is there: its classes still render as nothing without it.
    const unloaded = unloadedAppStylesheets(summary, preview);
    // Loading a sheet is only half of it: one whose Tailwind syntax can't be
    // expanded loads without the rules that syntax wrote.
    const unprocessed = (
      await unprocessedStylesheets([
        ...entryStylesheets(preview, summary.hostRoot),
        ...unloaded.flatMap((sheet) => (sheet.path ? [sheet.path] : [])),
      ])
    ).map((sheet) => ({
      ...sheet,
      path: relative(ctx.folder.root, sheet.path).split(sep).join("/"),
    }));
    const verdict: PreviewStatus =
      state === "valid" && (unloaded.length > 0 || unprocessed.length > 0) ? "incomplete" : state;
    const suggestion =
      verdict === "valid" && preview.kind === "file"
        ? undefined
        : suggestPreviewEntry(summary, ctx.folder.root);
    return jsonResult({
      ...(app ? { app } : {}),
      state: verdict,
      preview: {
        kind: preview.kind,
        label: preview.label,
        ...(preview.kind === "file"
          ? { path: relative(ctx.folder.root, preview.path).split(sep).join("/") }
          : {}),
      },
      recipes: summary.recipes,
      appWrappers: summary.wrappers.map((wrapper) => ({
        name: wrapper.name,
        from: wrapper.identity.importPath,
        at: wrapper.at,
        ...(wrapper.expressions.length > 0 ? { codeProps: wrapper.expressions } : {}),
      })),
      appStylesheets: summary.globalStyles,
      ...(unloaded.length > 0
        ? { unloadedStylesheets: unloaded.map(({ specifier, at }) => ({ specifier, at })) }
        : {}),
      ...(unprocessed.length > 0 ? { unprocessedStylesheets: unprocessed } : {}),
      components: catalog.entries.filter((entry) => (entry.identity.app ?? undefined) === app)
        .length,
      ...(probeResult ? { probe: probeResult } : {}),
      ...(suggestion ? { suggestedPreviewEntry: suggestion } : {}),
      ...(catalog.warnings.length > 0 ? { warnings: catalog.warnings } : {}),
      next: nextStep(verdict, preview.kind, summary.recipes.length > 0, unloaded, unprocessed),
    });
  };

  mcp.registerTool(
    "preview_status",
    {
      description:
        "Check the preview entry the app's own components render inside on the canvas — the providers and global stylesheets they need (a MantineProvider, a router, a query client, `styles.css`). Mounts one real component in a headless browser and reports `state` (absent / valid / incomplete / failing) with the reason: a missing provider, an app stylesheet the entry never loads, a throwing wrapper. Lists the wrappers and stylesheets the app's own entry uses and returns a `suggestedPreviewEntry` to adapt. Run it first in a folder whose app has components, then `set_preview_entry`.",
      inputSchema: {
        app: z.string().min(1).optional().describe("config.hostApps key; default app when omitted"),
        component: z
          .string()
          .min(1)
          .optional()
          .describe("Catalog id to probe; default the first one the app uses"),
        probe: z.boolean().optional().describe("Mount a component to verify (default true)"),
      },
    },
    async ({ app, component, probe }) => status(app, component, probe ?? true),
  );

  mcp.registerTool(
    "set_preview_entry",
    {
      description:
        "Write the design folder's preview entry (`preview.tsx`) and verify it by mounting a real component — returns the same report as `preview_status`. The module's default export receives `{ children, colorScheme, theme, recipeTheme }` and returns the providers and fixtures the app's components need; import the app's global stylesheets at the top. Keep it free of network calls and credentials.",
      inputSchema: {
        source: z.string().min(1).max(MAX_PREVIEW_BYTES).describe("TSX/JSX module source"),
        app: z.string().min(1).optional().describe("config.hostApps key; default app when omitted"),
      },
    },
    async ({ source, app }) => {
      if (!/export\s+default\b/.test(source)) {
        return errorResult({
          kind: "BadRequest",
          message: "The preview entry needs a default export: the wrapper component.",
        });
      }
      if (ctx.repo && app && !ctx.repo.apps().some((entry) => entry.app === app)) {
        return errorResult({
          kind: "BadRequest",
          message: `No host app ${JSON.stringify(app)} — see config.hostApps.`,
        });
      }
      // Only this app's own file: `preview.tsx` belongs to the default app.
      const stem = app ? `preview.${app}.` : "preview.";
      const existing = previewFileCandidates(ctx.folder.root, app)
        .filter((path) => basename(path).startsWith(stem))
        .find((path) => existsSync(path));
      const path = existing ?? join(ctx.folder.root, app ? `preview.${app}.tsx` : "preview.tsx");
      await writeFile(path, source, "utf8");
      ctx.repo?.invalidate();
      canvasBundler.invalidate();
      ctx.broadcast({ type: "config-changed" });
      return status(app, undefined, true);
    },
  );
}

type PreviewStatus = "absent" | "valid" | "incomplete" | "failing";

function nextStep(
  state: PreviewStatus,
  kind: string,
  recipe: boolean,
  unloaded: readonly UnloadedStylesheet[],
  unprocessed: readonly UnprocessedStylesheet[],
): string {
  if (state === "incomplete") {
    const parts: string[] = [];
    if (unloaded.length > 0) {
      const sheets = unloaded
        .map((sheet) => `${sheet.specifier} (imported at ${sheet.at})`)
        .join(", ");
      parts.push(
        `Components mount, but the preview entry doesn't load the app's global stylesheet${unloaded.length > 1 ? "s" : ""} ${sheets} — so the app's own classes and the CSS variables they read render as nothing, even inside its components. Adapt suggestedPreviewEntry, which imports ${unloaded.length > 1 ? "them" : "it"}, and call set_preview_entry.`,
      );
    }
    if (unprocessed.length > 0) {
      const sheets = unprocessed.map((sheet) => `${sheet.path} (${sheet.error})`).join(", ");
      parts.push(
        `${unprocessed.length > 1 ? "These stylesheets need" : "This stylesheet needs"} Tailwind processing Velloo can't do: ${sheets}. ${unprocessed.length > 1 ? "They load" : "It loads"} as written, so its plain CSS and variables apply but every rule written with @apply, @tailwind or the app's Tailwind config does not render — use those utilities directly in className instead.`,
      );
    }
    return parts.join(" ");
  }
  if (state === "valid" && kind === "file") {
    return "The preview entry works. Compose with the app's components (list_components' Repo shelves); author proxy snippets only for components component_status reports as proxy or unavailable.";
  }
  if (state === "valid") {
    return recipe
      ? "A built-in recipe wraps the components, themed from Velloo's tokens. To use the app's own theme, router or data providers instead, adapt suggestedPreviewEntry and call set_preview_entry."
      : "Components render without a wrapper. Add one with set_preview_entry if they need a provider or global CSS.";
  }
  if (state === "absent") {
    return "No preview entry yet: adapt suggestedPreviewEntry (the app's own providers and stylesheets) and call set_preview_entry.";
  }
  return "The probe failed — fix what `probe` names (usually a missing provider or stylesheet) in the preview entry via set_preview_entry, then re-check.";
}

async function runProbe(
  ctx: MutationContext,
  jit: TailwindJit,
  bundler: LiveBundler,
  canvasBundler: CanvasBundler,
  entry: RepoCatalogEntry,
  assetOrigin: string | undefined,
) {
  const state = entry.states[0]?.props ?? {};
  const node: ComponentNode = {
    $ref: entry.name,
    $repo: entry.identity,
    props:
      Object.keys(state).length > 0 ? state : entry.acceptsChildren ? { children: entry.name } : {},
  };
  const screen: Screen = {
    id: `probe-${repoKey(entry.identity).length}`,
    name: `${entry.name} probe`,
    tree: node,
  };
  const viewport = defaultViewport(ctx.folder);
  const html = await renderForCapture(ctx, screen, {
    theme: themeByName(ctx.folder, undefined),
    dark: false,
    viewport,
    snapshotCss: await jit.build(),
    liveUrl: makeLiveUrl(ctx, bundler),
    canvasBundle: makeCanvasBundle(ctx, canvasBundler),
    assetOrigin,
  });
  const outcome = await probeCanvasMount({ html, viewport });
  recordMount(canvasBundler, outcome);
  return outcome;
}
