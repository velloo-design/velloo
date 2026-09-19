import { err, ok, type Result } from "@velloo/result";
import type { Screen } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import type { MutationError } from "./errors.ts";
import { ensureKnownComponent } from "./lookup.ts";

/** Synthesized by previews for an unfilled param; never a registry component. */
const PARAM_TAG_REF = "velloo:param-tag";

/**
 * Check every `$ref` written into a value — child nodes, a node-valued prop,
 * a node argument to a snippet — the way `add_node` checks its one. A bare name
 * that is the app's own component (listed, or an export of a package the app
 * renders from) gains its `$repo` identity, as it would through compose; a name
 * nothing knows is refused here, where the caller can fix it, rather than when
 * the screen next renders and fails as a whole.
 *
 * A generic JSON walk for the same reason `snippetIdsIn` is one: a node can sit
 * anywhere a props bag or args map can hold a value.
 */
export async function resolveComponentRefs<T>(
  ctx: MutationContext,
  value: T,
  scope: Pick<Screen, "library"> | null,
): Promise<Result<T, MutationError>> {
  const walk = async (v: unknown): Promise<Result<unknown, MutationError>> => {
    if (v === null || typeof v !== "object") return ok(v);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) {
        const r = await walk(item);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return ok(out);
    }
    const record = { ...(v as Record<string, unknown>) };
    const ref = record.$ref;
    if (typeof ref === "string" && record.$repo === undefined && ref !== PARAM_TAG_REF) {
      const known = ensureKnownComponent(ctx, ref, scope);
      if (!known.ok) {
        const entry = await appComponent(ctx, ref);
        if (!entry) return known;
        record.$ref = entry.name;
        record.$repo = entry.identity;
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key === "$repo") continue;
      const r = await walk(nested);
      if (!r.ok) return r;
      record[key] = r.value;
    }
    return ok(record);
  };
  const result = await walk(value);
  return result.ok ? ok(result.value as T) : err(result.error);
}

async function appComponent(ctx: MutationContext, name: string) {
  if (!ctx.repo) return null;
  const catalog = await ctx.repo.catalog().catch(() => null);
  return catalog?.byId.get(name) ?? (await ctx.repo.resolveName(name).catch(() => null));
}
