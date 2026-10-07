import { err, ok, type Result } from "@velloo/result";
import { PARAM_TAG_REF, type Screen } from "@velloo/schema";
import type { MutationContext } from "./context.ts";
import { type MutationError, shadowedComponent } from "./errors.ts";
import { ensureKnownComponent } from "./lookup.ts";
import { shadowingAppComponent, soleShadowingAppComponent } from "./prop-warnings.ts";

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
  const shadowed = await shadowedNodesIn(ctx, value, scope);
  if (shadowed.length > 0) return err(shadowedComponent(shadowed));
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

type ShadowedNode = Parameters<typeof shadowedComponent>[0][number];

/**
 * Every node in a value whose bare name resolves to Velloo's own component
 * while its props are the app's same-named component's: the shape of
 * emit_code's output pasted back into compose. A warning beside a successful
 * write was ignored in practice, and the design silently lost those props, so
 * writes refuse these outright and name the qualified component instead.
 *
 * `at` names a node by its `@id` when it has one, else by its JSON path from
 * `base`.
 */
export async function shadowedNodesIn(
  ctx: MutationContext,
  value: unknown,
  scope: Pick<Screen, "library"> | null,
  base = "root",
): Promise<ShadowedNode[]> {
  if (!ctx.repo) return [];
  const out: ShadowedNode[] = [];
  const walk = async (v: unknown, at: string): Promise<void> => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const [i, item] of v.entries()) await walk(item, `${at}.${i}`);
      return;
    }
    const record = v as Record<string, unknown>;
    const { $ref: ref, $repo: repo, $id: id, props } = record;
    const label = typeof id === "string" ? `@${id}` : at;
    if (
      typeof ref === "string" &&
      repo === undefined &&
      ref !== PARAM_TAG_REF &&
      props !== null &&
      typeof props === "object" &&
      !Array.isArray(props) &&
      ensureKnownComponent(ctx, ref, scope).ok
    ) {
      const shadow = await shadowingAppComponent(ctx, scope, ref, props as Record<string, unknown>);
      if (shadow) out.push({ at: label, ref, appComponent: shadow.id, props: shadow.takes });
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key !== "$repo") await walk(nested, `${label}.${key}`);
    }
  };
  await walk(value, base);
  return out;
}

/** A bare name compose read as the app's component, and the props that said so. */
export interface QualifiedAppComponent {
  name: string;
  as: string;
  props: string[];
  nodes: number;
}

/**
 * compose's reading of the nodes `shadowedNodesIn` would refuse: a bare name
 * given props only the app's same-named component takes is written as that
 * component, when exactly one such component exists. The refusal's own advice
 * is "write <Mantine.Text>", and following it meant resending a whole screen
 * of JSX — the most common error in the eval traces, at one to three resends a
 * run. What made a refusal necessary was props silently lost on Velloo's
 * component; here they land on the component that takes them, and the result
 * says which names were read this way.
 *
 * Only compose calls this. The other writers (a tree passed as JSON, a prop
 * patch on a node that already exists) keep refusing: changing what an
 * existing node is because of a prop it was handed is not theirs to decide.
 */
export async function qualifyAppComponents<T>(
  ctx: MutationContext,
  value: T,
  scope: Pick<Screen, "library"> | null,
): Promise<{ value: T; qualified: QualifiedAppComponent[] }> {
  if (!ctx.repo) return { value, qualified: [] };
  const read = new Map<string, QualifiedAppComponent & { seen: Set<string> }>();
  const walk = async (v: unknown): Promise<unknown> => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) out.push(await walk(item));
      return out;
    }
    const record = { ...(v as Record<string, unknown>) };
    const { $ref: ref, $repo: repo, props } = record;
    if (
      typeof ref === "string" &&
      repo === undefined &&
      ref !== PARAM_TAG_REF &&
      props !== null &&
      typeof props === "object" &&
      !Array.isArray(props) &&
      ensureKnownComponent(ctx, ref, scope).ok
    ) {
      const meant = await soleShadowingAppComponent(
        ctx,
        scope,
        ref,
        props as Record<string, unknown>,
      );
      if (meant) {
        record.$ref = meant.entry.name;
        record.$repo = meant.entry.identity;
        const entry = read.get(meant.entry.id) ?? {
          name: ref,
          as: meant.entry.id,
          props: [],
          nodes: 0,
          seen: new Set<string>(),
        };
        for (const prop of meant.takes) entry.seen.add(prop);
        entry.nodes += 1;
        read.set(meant.entry.id, entry);
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key !== "$repo") record[key] = await walk(nested);
    }
    return record;
  };
  const next = (await walk(value)) as T;
  return {
    value: read.size > 0 ? next : value,
    qualified: [...read.values()].map(({ seen, ...entry }) => ({ ...entry, props: [...seen] })),
  };
}
