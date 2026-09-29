/**
 * Where a rendered element sits inside the snippet definition it was
 * materialized from — what editing a snippet in place addresses, beside the
 * instance path (`data-node-path`) a click on the screen selects.
 */
export interface BodyPosition {
  snippetId: string;
  path: number[];
  /**
   * Set on a nested instance's root: its positions in the bodies that contain
   * it (`shell#0.1.2`). The nested body re-roots at its own definition, so
   * without these the instance can't be found from the snippet being edited.
   */
  at?: string[];
}

export function descend(body: BodyPosition | null, index: number): BodyPosition | null {
  return body === null ? null : { snippetId: body.snippetId, path: [...body.path, index] };
}

/** The body a snippet instance at `body` opens: its own definition, from its root. */
export function enterSnippet(body: BodyPosition | null, snippetId: string): BodyPosition {
  if (body === null) return { snippetId, path: [] };
  const here = `${body.snippetId}#${body.path.join(".")}`;
  // An instance at the root of another nested body stands where that one does too.
  const outer = body.path.length === 0 ? (body.at ?? []) : [];
  return { snippetId, path: [], at: [here, ...outer] };
}

/** The attributes that carry `body` onto an element. */
export function bodyAttributes(body: BodyPosition | null): Record<string, string> {
  if (body === null) return {};
  return {
    "data-snippet-id": body.snippetId,
    "data-snippet-path": body.path.join("."),
    ...(body.at && body.path.length === 0 ? { "data-snippet-at": body.at.join(" ") } : {}),
  };
}
