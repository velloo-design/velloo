import { err, ok, type Result } from "@velloo/result";
import { NodeSchema, type Snippet, snippetChildSlots } from "@velloo/schema";
import { type MutationError, scalarChildrenHint, snippetParamMismatch } from "./errors.ts";

/**
 * A snippet's `node` args read as `NodeSchema` reads a node: a string is
 * text, a list is several nodes, anything else is refused naming the param.
 * Args are stored opaque, so without this a node arg reached the renderer as
 * written — a string child where a node goes failed only when the screen
 * rendered, as the whole render.
 *
 * Only a param the body places as a child is read this way. `node` is also
 * the type agents give a param that carries data into a prop (a `review`
 * object handed to the app's `ReviewCard`), which renders as written — and
 * there a string must stay a string. Every other arg is left as it is.
 *
 * `null` passes through untouched: it is how an arg patch clears an arg.
 */
export function readNodeArgs(
  snippet: Snippet,
  args: Record<string, unknown>,
): Result<Record<string, unknown>, MutationError> {
  const read: Record<string, unknown> = { ...args };
  const slots = snippetChildSlots(snippet);
  for (const param of snippet.params) {
    if (param.type !== "node" || !slots.has(param.name) || !(param.name in read)) continue;
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
  return ok(read);
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
  const hint = scalarChildrenHint(parsed.error.issues);
  const problem = describeIssue(parsed.error.issues[0]);
  return { ok: false, problem: hint ? `${problem}. ${hint}` : problem };
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
