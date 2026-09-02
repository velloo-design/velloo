import { err, ok, type Result } from "@velloo/result";
import { type Config, type ViewportPreset, ViewportPresetSchema } from "@velloo/schema";
import { writeRepoFeedback } from "../repo-config.ts";
import type { MutationContext } from "./context.ts";
import { badRequest, boardNotFound, type MutationError, screenNotFound } from "./errors.ts";
import { persistConfig } from "./persist.ts";

/**
 * Folder-config mutations — the write half of what `init` decided and the
 * settings dialog edits. Every one is read-modify-write on `folder.config`,
 * so they run under the config lock (see `withConfigLock`) and end in
 * `persistConfig` + a `config-changed` broadcast, which is how an agent's
 * MCP session and a second canvas tab learn about the change.
 *
 * `boardOrder` is the one config field that predates these — it lives with
 * the board mutations because reordering is a board operation.
 */

/**
 * Write the config and tell everyone. Shared tail of every mutation here so
 * none of them can forget the broadcast.
 */
async function commit(ctx: MutationContext, next: Config): Promise<Config> {
  const saved = await persistConfig(ctx.folder, next);
  ctx.broadcast({ type: "config-changed" });
  return saved;
}

export interface UpdateViewportPresetsArgs {
  /** The complete preset list, in display order. Replaces what's stored. */
  presets: ViewportPreset[];
}

export interface UpdateViewportPresetsResult {
  presets: ViewportPreset[];
}

/**
 * Replace the folder's viewport presets wholesale — the list is short and
 * order-significant, so a patch protocol would cost more than it saves.
 *
 * Presets are pure UI offers: a frame stores its own `w`/`h`, so renaming or
 * dropping one never touches an existing frame. The schema requires at least
 * one; names must be distinct so the picker can't show two identical rows.
 */
export async function updateViewportPresets(
  ctx: MutationContext,
  args: UpdateViewportPresetsArgs,
): Promise<Result<UpdateViewportPresetsResult, MutationError>> {
  const parsed = ViewportPresetSchema.array().safeParse(args.presets);
  if (!parsed.success) {
    return err(
      badRequest("Each viewport preset needs a name and positive w/h.", parsed.error.issues),
    );
  }
  const presets = parsed.data.map((p) => ({ ...p, name: p.name.trim() }));
  if (presets.length === 0) {
    return err(badRequest("A folder needs at least one viewport preset."));
  }
  if (presets.some((p) => p.name === "")) {
    return err(badRequest("A viewport preset needs a name."));
  }
  const seen = new Set<string>();
  for (const p of presets) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) {
      return err(badRequest(`Two viewport presets are both named "${p.name}".`));
    }
    seen.add(key);
  }
  await commit(ctx, { ...ctx.folder.config, viewportPresets: presets });
  return ok({ presets });
}

export interface UpdateDefaultsArgs {
  /** Board id to open on; `null` clears back to "first board". Omit to leave alone. */
  defaultBoard?: string | null;
  /** Screen id to focus on load; `null` clears. Omit to leave alone. */
  defaultScreen?: string | null;
}

export interface UpdateDefaultsResult {
  defaultBoard: string | null;
  defaultScreen: string | null;
}

/**
 * Set what the canvas opens on. Both fields are three-state — absent leaves
 * the stored value, `null` clears it, a string sets it — so the dialog can
 * write one without knowing the other.
 */
export async function updateDefaults(
  ctx: MutationContext,
  args: UpdateDefaultsArgs,
): Promise<Result<UpdateDefaultsResult, MutationError>> {
  const next = { ...ctx.folder.config };
  if (args.defaultBoard !== undefined) {
    if (args.defaultBoard === null) {
      delete next.defaultBoard;
    } else {
      if (!ctx.folder.boards.has(args.defaultBoard)) {
        return err(boardNotFound(args.defaultBoard));
      }
      next.defaultBoard = args.defaultBoard;
    }
  }
  if (args.defaultScreen !== undefined) {
    if (args.defaultScreen === null) {
      delete next.defaultScreen;
    } else {
      if (!ctx.folder.screens.has(args.defaultScreen)) {
        return err(screenNotFound(args.defaultScreen));
      }
      next.defaultScreen = args.defaultScreen;
    }
  }
  const saved = await commit(ctx, next);
  return ok({
    defaultBoard: saved.defaultBoard ?? null,
    defaultScreen: saved.defaultScreen ?? null,
  });
}

export interface UpdateCodegenArgs {
  /** Import prefix for emitted library imports; `null` restores the default. */
  componentsAlias?: string | null;
}

export interface UpdateCodegenResult {
  componentsAlias: string | null;
}

/**
 * Edit the codegen block. Clearing `componentsAlias` drops the whole
 * `codegen` object rather than leaving `{}` behind, so a folder that never
 * customized it reads the same as one that customized and reverted.
 */
export async function updateCodegen(
  ctx: MutationContext,
  args: UpdateCodegenArgs,
): Promise<Result<UpdateCodegenResult, MutationError>> {
  const next = { ...ctx.folder.config };
  if (args.componentsAlias !== undefined) {
    const alias = args.componentsAlias?.trim() ?? null;
    if (alias === "") {
      return err(badRequest("The components alias can't be empty — clear it to use the default."));
    }
    const codegen = { ...next.codegen, ...(alias === null ? {} : { componentsAlias: alias }) };
    if (alias === null) delete codegen.componentsAlias;
    if (Object.keys(codegen).length === 0) delete next.codegen;
    else next.codegen = codegen;
  }
  const saved = await commit(ctx, next);
  return ok({ componentsAlias: saved.codegen?.componentsAlias ?? null });
}

export interface UpdateFeedbackArgs {
  /** Whether the `send_feedback` MCP tool is exposed. Omit to leave alone. */
  enabled?: boolean;
  /** Consent to be contacted about submitted feedback. Omit to leave alone. */
  contactOk?: boolean;
}

export interface UpdateFeedbackResult {
  enabled: boolean;
  contactOk: boolean;
}

/**
 * Toggle product feedback and its contact consent. `contactOk` survives
 * switching `enabled` off and on — it records what the user agreed to, not
 * whether the tool is live right now.
 *
 * The answer is a *repo* preference (`velloo.json`), so every design folder
 * in the repo moves together and a second folder never re-asks. A folder
 * outside any registered repo has nowhere higher to write, so it keeps the
 * answer in its own config — the historical location, still read as the
 * fallback.
 */
export async function updateFeedback(
  ctx: MutationContext,
  args: UpdateFeedbackArgs,
): Promise<Result<UpdateFeedbackResult, MutationError>> {
  const current = ctx.folder.config.feedback;
  const feedback = {
    enabled: args.enabled ?? current?.enabled ?? false,
    contactOk: args.contactOk ?? current?.contactOk ?? false,
  };
  const wroteRepo = await writeRepoFeedback(ctx.folder.root, feedback);
  if (wroteRepo) {
    // The folder config didn't change, but every reader reads through it —
    // keep the in-memory copy honest and tell the canvas to re-read.
    ctx.folder.config = { ...ctx.folder.config, feedback };
    ctx.broadcast({ type: "config-changed" });
    return ok({ enabled: feedback.enabled, contactOk: feedback.contactOk });
  }
  const saved = await commit(ctx, { ...ctx.folder.config, feedback });
  return ok({
    enabled: saved.feedback?.enabled ?? false,
    contactOk: saved.feedback?.contactOk ?? false,
  });
}
