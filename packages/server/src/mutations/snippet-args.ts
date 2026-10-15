import { err, type Result } from "@velloo/result";
import { NodeSchema, type Screen, type Snippet } from "@velloo/schema";
import { resolveComponentRefs } from "./component-refs.ts";
import type { MutationContext } from "./context.ts";
import { type MutationError, snippetParamMismatch } from "./errors.ts";

/**
 * A snippet's args as every writer of them — and the preview — should take
 * them. Args are stored opaque, so nothing else checks them: a node arg never
 * passed through `NodeSchema` (a string child stayed a string, where anywhere
 * else it is text), and a bare name of the app's own component stayed a name
 * Velloo's library doesn't have. Either failed only when the screen rendered,
 * as the whole render. Here a `node` arg is read as `NodeSchema` reads a node —
 * a string is text, a list is several — and a name is resolved the way
 * `resolveComponentRefs` resolves one written anywhere else.
 *
 * `null` passes through untouched: it is how an arg patch clears an arg.
 */
export async function checkSnippetArgs(
  ctx: MutationContext,
  snippet: Snippet,
  args: Record<string, unknown>,
  scope: Pick<Screen, "library"> | null,
): Promise<Result<Record<string, unknown>, MutationError>> {
  const read: Record<string, unknown> = { ...args };
  for (const param of snippet.params) {
    if (param.type !== "node" || !(param.name in read)) continue;
    const value = read[param.name];
    if (value === null || value === undefined) continue;
    const items = (Array.isArray(value) ? value : [value]).map(asNode);
    const refused = items.find((item) => !item.ok);
    if (refused && !refused.ok) {
      return err(
        snippetParamMismatch(snippet.id, `"${param.name}" is a node param: ${refused.problem}`),
      );
    }
    const nodes = items.map((item) => (item.ok ? item.node : null));
    read[param.name] = Array.isArray(value) ? nodes : nodes[0];
  }
  return resolveComponentRefs(ctx, read, scope);
}

/**
 * One node of a node arg. A `$if` stays as written — it is a snippet body's
 * branch on its own params, resolved when the body renders, not a node yet.
 */
function asNode(value: unknown): { ok: true; node: unknown } | { ok: false; problem: string } {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value);
    return text === ""
      ? { ok: false, problem: "an empty string is no node" }
      : { ok: true, node: { $text: text } };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { $if?: unknown }).$if === "string"
  ) {
    return { ok: true, node: value };
  }
  const parsed = NodeSchema.safeParse(value);
  if (parsed.success) return { ok: true, node: parsed.data };
  return { ok: false, problem: describeIssue(parsed.error.issues[0]) };
}

type Issue = { message: string; path: PropertyKey[]; code?: string; errors?: Issue[][] };

/**
 * A child that is no node fails a union — string, number or node — whose own
 * message is "Invalid input". The node branch says what a node is, so that is
 * the sentence worth sending back.
 */
function describeIssue(issue: Issue | undefined, at: PropertyKey[] = []): string {
  if (!issue) return "not a node";
  const path = [...at, ...issue.path];
  if (issue.code === "invalid_union") {
    const said = issue.errors?.flat().find((inner) => inner.code === "custom");
    if (said) return describeIssue(said, path);
  }
  return path.length > 0 ? `${issue.message} (at ${path.join(".")})` : issue.message;
}
