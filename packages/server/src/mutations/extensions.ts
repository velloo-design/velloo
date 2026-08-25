import { err, ok, type Result } from "@velloo/result";
import {
  type Extension,
  type ExtensionPropDescriptor,
  ExtensionPropDescriptorSchema,
  ExtensionSchema,
  isComponentNode,
  type Node,
} from "@velloo/schema";
import { resolveLiveImportWarning } from "../live/component-bundler.ts";
import type { MutationContext } from "./context.ts";
import {
  extensionIdConflict,
  extensionInUse,
  extensionNotFound,
  type MutationError,
} from "./errors.ts";
import { persistConfig } from "./persist.ts";

/**
 * Walk every screen + snippet tree looking for `{ $ref: <id> }` nodes
 * — used by `remove_extension` to refuse the removal when the
 * extension is still in use. Returns dotted-path locations so the
 * agent can resolve and update them.
 */
function findExtensionReferences(
  ctx: MutationContext,
  extensionId: string,
): { screenId: string; path: string }[] {
  const out: { screenId: string; path: string }[] = [];

  function visit(node: Node, screenId: string, path: number[]): void {
    if (isComponentNode(node)) {
      if (node.$ref === extensionId) {
        out.push({ screenId, path: path.join(".") });
      }
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          const child = node.children[i];
          if (child) visit(child, screenId, [...path, i]);
        }
      }
    }
  }

  for (const [screenId, screen] of ctx.folder.screens) {
    visit(screen.tree, screenId, []);
  }
  for (const [snippetId, snippet] of ctx.folder.snippets) {
    visit(snippet.tree, `snippet:${snippetId}`, []);
  }
  return out;
}

export interface AddExtensionArgs {
  id: string;
  importPath: string;
  props: ExtensionPropDescriptor[];
  category?: "ui" | "typography";
  description?: string;
  render?: "static" | "live";
  app?: string;
  fit?: "aspect-video" | "content";
}

/** Reject an `app` that isn't a `config.hostApps` key (a typo, not a warning). */
function unknownHostApp(ctx: MutationContext, app: string | undefined): MutationError | null {
  if (!app) return null;
  const known = Object.keys(ctx.folder.config.hostApps ?? {});
  if (known.includes(app)) return null;
  return {
    kind: "BadRequest",
    message: `app "${app}" is not a key of config.hostApps.`,
    hint: known.length
      ? `Known apps: ${known.join(", ")}. Omit \`app\` to use the default host app.`
      : "This folder has no config.hostApps — omit `app` to use the default host app.",
  };
}

export interface AddExtensionResult {
  id: string;
  extension: Extension;
  /**
   * When the new id matches a library component name, the extension
   * shadows it. We return the shadowed component id so the agent can
   * decide whether to rename their extension. Empty when no shadow.
   */
  shadowedLibraryComponent?: string;
  /**
   * Set when `render:"live"` but the importPath can't be resolved from the
   * host app — the canvas will show the placeholder until it's fixed.
   */
  liveResolveWarning?: string;
}

export async function addExtension(
  ctx: MutationContext,
  args: AddExtensionArgs,
): Promise<Result<AddExtensionResult, MutationError>> {
  const existing = ctx.folder.config.extensions ?? {};
  if (args.id in existing) return err(extensionIdConflict(args.id));

  const badApp = unknownHostApp(ctx, args.app);
  if (badApp) return err(badApp);

  // Validate the prop schema up front so a malformed input fails fast
  // before we touch disk. Zod surfaces field-level paths in the error.
  for (const p of args.props) {
    const parsed = ExtensionPropDescriptorSchema.safeParse(p);
    if (!parsed.success) {
      return err({
        kind: "InvalidExtensionProp",
        message: `Invalid extension prop schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
        extensionId: args.id,
        prop: p.name,
      });
    }
  }

  const extension: Extension = ExtensionSchema.parse({
    importPath: args.importPath,
    category: args.category,
    description: args.description,
    props: args.props,
    origin: "agent",
    render: args.render,
    app: args.app,
    fit: args.fit,
  });

  const shadowed = args.id in ctx.defaultProvider.registry ? args.id : undefined;

  const nextConfig = {
    ...ctx.folder.config,
    extensions: { ...existing, [args.id]: extension },
  };
  await persistConfig(ctx.folder, nextConfig);
  ctx.broadcast({ type: "config-changed" });
  const result: AddExtensionResult = { id: args.id, extension };
  if (shadowed) result.shadowedLibraryComponent = shadowed;
  if (extension.render === "live") {
    const warning = resolveLiveImportWarning(
      ctx.folder.root,
      ctx.folder.config,
      args.importPath,
      extension.app,
    );
    if (warning) result.liveResolveWarning = warning;
  }
  return ok(result);
}

export interface UpdateExtensionArgs {
  id: string;
  patch: {
    importPath?: string;
    props?: ExtensionPropDescriptor[];
    category?: "ui" | "typography";
    description?: string;
    render?: "static" | "live";
    app?: string;
    fit?: "aspect-video" | "content";
  };
}

export interface UpdateExtensionResult {
  id: string;
  extension: Extension;
  /** Set when the updated extension is `render:"live"` but won't resolve. */
  liveResolveWarning?: string;
}

export async function updateExtension(
  ctx: MutationContext,
  args: UpdateExtensionArgs,
): Promise<Result<UpdateExtensionResult, MutationError>> {
  const existing = ctx.folder.config.extensions ?? {};
  const prev = existing[args.id];
  if (!prev) return err(extensionNotFound(args.id));

  const badApp = unknownHostApp(ctx, args.patch.app);
  if (badApp) return err(badApp);

  if (args.patch.props) {
    for (const p of args.patch.props) {
      const parsed = ExtensionPropDescriptorSchema.safeParse(p);
      if (!parsed.success) {
        return err({
          kind: "InvalidExtensionProp",
          message: `Invalid extension prop schema: ${parsed.error.issues[0]?.message ?? "unknown"}`,
          extensionId: args.id,
          prop: p.name,
        });
      }
    }
  }

  const next: Extension = ExtensionSchema.parse({
    ...prev,
    ...(args.patch.importPath !== undefined ? { importPath: args.patch.importPath } : {}),
    ...(args.patch.props !== undefined ? { props: args.patch.props } : {}),
    ...(args.patch.category !== undefined ? { category: args.patch.category } : {}),
    ...(args.patch.description !== undefined ? { description: args.patch.description } : {}),
    ...(args.patch.render !== undefined ? { render: args.patch.render } : {}),
    ...(args.patch.app !== undefined ? { app: args.patch.app } : {}),
    ...(args.patch.fit !== undefined ? { fit: args.patch.fit } : {}),
  });

  const nextConfig = {
    ...ctx.folder.config,
    extensions: { ...existing, [args.id]: next },
  };
  await persistConfig(ctx.folder, nextConfig);
  ctx.broadcast({ type: "config-changed" });
  const result: UpdateExtensionResult = { id: args.id, extension: next };
  if (next.render === "live") {
    const warning = resolveLiveImportWarning(
      ctx.folder.root,
      ctx.folder.config,
      next.importPath,
      next.app,
    );
    if (warning) result.liveResolveWarning = warning;
  }
  return ok(result);
}

export interface RemoveExtensionArgs {
  id: string;
}

export interface RemoveExtensionResult {
  id: string;
}

export async function removeExtension(
  ctx: MutationContext,
  args: RemoveExtensionArgs,
): Promise<Result<RemoveExtensionResult, MutationError>> {
  const existing = ctx.folder.config.extensions ?? {};
  if (!(args.id in existing)) return err(extensionNotFound(args.id));

  const refs = findExtensionReferences(ctx, args.id);
  if (refs.length > 0) return err(extensionInUse(args.id, refs));

  const { [args.id]: _, ...rest } = existing;
  const extensions = Object.keys(rest).length > 0 ? rest : undefined;
  const nextConfig = { ...ctx.folder.config, extensions };
  await persistConfig(ctx.folder, nextConfig);
  ctx.broadcast({ type: "config-changed" });
  return ok({ id: args.id });
}
