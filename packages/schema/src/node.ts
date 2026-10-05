import { z } from "zod";

/**
 * A node tree is a discriminated union over four shapes, distinguished by
 * which `$`-prefixed key is present:
 *
 * - `ComponentNode` — a real shadcn / velloo component (`{ $ref }`).
 * - `SnippetInstance` — an instantiation of a snippet defined in `snippets/`
 *   (`{ $snippet, args }`). From the page's POV the instance is opaque —
 *   path navigation stops at the instance; you can edit its args but not
 *   descend into the snippet body.
 * - `ParamRef` — `{ $param: name }`. Valid only inside a snippet body;
 *   substituted with the corresponding instance arg at render time. May
 *   appear as a child node OR anywhere inside a `props` value via the
 *   normal JSON walk during substitution.
 * - `TextNode` — `{ $text }`. A run of text sitting beside elements
 *   (`<li>Remote <a>Apply</a></li>`). It renders as a bare text node, with no
 *   element of its own, so no selector in the app's stylesheet can tell the
 *   design's DOM from the app's. Text that is a component's *whole* content
 *   stays in `props.children`.
 *
 * Optional fields are spelled `?: T | undefined` rather than `?: T`. Under
 * `exactOptionalPropertyTypes` those differ, but not for a shape that round-
 * trips through JSON: `JSON.stringify` drops an explicitly-undefined key, so
 * "absent" and "present but undefined" are the same node on disk. Writing it
 * this way lets the zod schemas below (whose `.optional()` yields
 * `T | undefined`) describe these types exactly.
 *
 * `ComponentNode` and `SnippetInstance` may carry an optional `$id` —
 * a stable anchor that survives sibling insertions and deletions. Ids
 * are unique within a single screen tree (validated at persist time).
 * Agents address `$id`-bearing nodes via the locator form `"@id"` in
 * place of a path array.
 *
 * Schema-level validation accepts all three at every Node position. Screen
 * trees are expected to contain only `ComponentNode | SnippetInstance`;
 * `ParamRef`s in a screen tree fail at substitution time rather than at
 * parse time so the schema stays simple.
 */
export type ComponentNode = {
  $ref: string;
  $id?: string | undefined;
  props?: Record<string, unknown> | undefined;
  children?: Node[] | undefined;
  /**
   * Host-component facade (scan/import of a host-app component). When
   * set, the canvas renders this node's real
   * velloo subtree (the design agent's faithful approximation of a scanned app
   * component it can't map to a primitive — SSR-only, data-bound, bespoke), but
   * `emit_code` emits `<name />` imported from `importPath` *instead* of the
   * subtree — preserving the app's real component identity through
   * capture → design → emit. Absent ⇒ the node emits as itself.
   */
  $emitAs?: EmitAsRef | undefined;
  /**
   * Repository component identity: this node IS a component the host app
   * imports (a package export such as Mantine's `Tabs`, or the app's own
   * `StatCard`), not a library component. `$ref` stays the JSX name codegen
   * prints; the identity decides rendering and imports. Where it sits against
   * the node's other keys is `nodeShape`'s to say (`./node-identity.ts`).
   */
  $repo?: RepoComponentRef | undefined;
};

/**
 * A host component a node emits *as*, in place of its own subtree. Superseded
 * in practice by {@link RepoComponentRef}, which renders for real; kept because
 * design folders carry it.
 */
export type EmitAsRef = {
  name: string;
  importPath: string;
};

/**
 * Where a repository component comes from. The import form is kept exactly as
 * code generation must print it; the resolved file is runtime cache data and
 * never persisted.
 */
export type RepoComponentRef = {
  /**
   * Module specifier. Bare (`@mantine/core`) and aliased (`@/components/card`)
   * specifiers are kept as the app writes them; a `./`-relative one is relative
   * to the host app root, since the importing file varies per call site.
   */
  importPath: string;
  /** The export binding, or `"default"` for a default export. */
  exportName: string;
  /** Static member path of a compound part: `"List"` for `Tabs.List`. */
  member?: string | undefined;
  /** `config.hostApps` key in a monorepo; absent ⇒ the default host app. */
  app?: string | undefined;
  /** Snippet id drawn in the component's place when it can't render for real. */
  proxy?: string | undefined;
};

export type SnippetInstance = {
  $snippet: string;
  $id?: string | undefined;
  /**
   * Extra Tailwind classes merged into the snippet body's root element at
   * render time. Lets one-off instances tweak styling (e.g. wider, accent
   * border) without forking the snippet definition. Pass it via
   * a snippet tag's `className` in `compose`, or `update_snippet_instance`.
   */
  $extraClassName?: string | undefined;
  args?: Record<string, unknown> | undefined;
  /**
   * Per-instance interior prop patches, keyed by dotted path into the
   * *resolved* snippet body ("" = root, "0.2" = third child of root's
   * first child). Each patch shallow-merges over the body node's props
   * at render time. The escape hatch for "this one instance needs its
   * badge red" without forking the snippet — instances carrying
   * overrides are inlined (not emitted as the shared component) by
   * emit_code, since a shared React component can't express them.
   */
  $overrides?: Record<string, { props: Record<string, unknown> }> | undefined;
};

export type ParamRef = {
  $param: string;
};

export type TextNode = {
  $text: string;
};

export type Node = ComponentNode | SnippetInstance | ParamRef | TextNode;

export function isComponentNode(n: Node): n is ComponentNode {
  return typeof (n as { $ref?: unknown }).$ref === "string";
}

export function isSnippetInstance(n: Node): n is SnippetInstance {
  return typeof (n as { $snippet?: unknown }).$snippet === "string";
}

export function isParamRef(n: Node): n is ParamRef {
  return typeof (n as { $param?: unknown }).$param === "string";
}

export function isTextNode(n: Node): n is TextNode {
  return typeof (n as { $text?: unknown }).$text === "string";
}

/**
 * Format constraint for `$id` values. Must start with a letter; the rest
 * is letters / digits / dashes / underscores. Matches typical anchor
 * naming (`hero-cta`, `feature_card_3`, `nav`). The leading-letter rule
 * keeps ids from colliding with numeric path indices in the locator
 * parser if we ever support compound locators.
 */
export const NodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
    message: "node id must match /^[a-zA-Z][a-zA-Z0-9_-]*$/",
  });

/**
 * A bare string/number in a `children` array is a common first-try shape
 * ("just put the label here"), and it means what it says: text. It becomes a
 * text node rather than being rejected, which keeps `children` typed `Node[]`
 * for every downstream consumer. An empty string is nothing to hold.
 */
function scalarChildren(items: (string | number | Node)[]): Node[] {
  return items.flatMap((item): Node[] => {
    if (typeof item !== "string" && typeof item !== "number") return [item];
    const text = String(item);
    return text === "" ? [] : [{ $text: text }];
  });
}

const EmitAsSchema = z.object({
  name: z.string().min(1),
  importPath: z.string().min(1),
});

/**
 * A specifier codegen may print verbatim inside `import … from "…"` and the
 * bundler may resolve against the host app. Conservative charset (no quotes,
 * spaces, semicolons), and no absolute or `..` paths: a design folder is data a
 * cloned repo supplies, and it must not be able to reach outside the app.
 */
export function repoImportIssue(importPath: string): string | null {
  if (!/^[\w@./~-]+$/.test(importPath)) return "has characters an import specifier can't carry";
  if (importPath.startsWith("/")) return "must not be an absolute path";
  if (importPath.split("/").includes("..")) return "must not climb out of the host app with ..";
  return null;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export const RepoComponentRefSchema = z.object({
  importPath: z
    .string()
    .min(1)
    .superRefine((value, ctx) => {
      const issue = repoImportIssue(value);
      if (issue) ctx.addIssue({ code: "custom", message: `importPath ${issue}` });
    }),
  exportName: z
    .string()
    .regex(IDENTIFIER, { message: 'exportName must be an identifier or "default"' }),
  member: z
    .string()
    .regex(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/, {
      message: 'member must be a dotted identifier path like "List"',
    })
    .optional(),
  app: z.string().min(1).optional(),
  proxy: z.string().min(1).optional(),
});

const ComponentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    $ref: z.string().min(1),
    $id: NodeIdSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z
      .array(z.union([z.string(), z.number(), NodeSchema]))
      .transform(scalarChildren)
      .optional(),
    $emitAs: EmitAsSchema.optional(),
    $repo: RepoComponentRefSchema.optional(),
  }),
);

/** True when the node is a repository component (see ComponentNode.$repo). */
export function isRepoNode(n: Node): n is ComponentNode & { $repo: RepoComponentRef } {
  return isComponentNode(n) && n.$repo !== undefined;
}

/**
 * The runtime key a repository component registers under — identity only, so
 * two apps' `Button`s (or Mantine's vs the provider's) never collide.
 */
export function repoKey(ref: RepoComponentRef): string {
  const member = ref.member ? `.${ref.member}` : "";
  return `repo:${encodeURIComponent(ref.app ?? "")}:${ref.importPath}#${ref.exportName}${member}`;
}

/**
 * Invert {@link repoKey}. A bundle URL carries only keys, so the runtime can
 * resolve a screen's components from identity alone — no catalog lookup, which
 * keeps a design renderable while discovery is cold or the app has moved on.
 */
export function parseRepoKey(key: string): RepoComponentRef | null {
  const match = /^repo:([^:]*):([^#]+)#([A-Za-z_$][\w$]*)(?:\.(.+))?$/.exec(key);
  if (!match) return null;
  const parsed = RepoComponentRefSchema.safeParse({
    importPath: match[2],
    exportName: match[3],
    ...(match[4] ? { member: match[4] } : {}),
    ...(match[1] ? { app: decodeURIComponent(match[1]) } : {}),
  });
  return parsed.success ? parsed.data : null;
}

const SnippetInstanceSchema: z.ZodType<SnippetInstance> = z.object({
  $snippet: z.string().min(1),
  $id: NodeIdSchema.optional(),
  $extraClassName: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  $overrides: z
    .record(
      z.string().regex(/^$|^\d+(\.\d+)*$|^@[a-zA-Z][a-zA-Z0-9_-]*$/, {
        message:
          'override key must be a dotted index path like "0.2", an "@id" reference with a literal leading @ (e.g. "@row-active" to target the body node whose $id is "row-active"), or "" for the body root',
      }),
      z.object({ props: z.record(z.string(), z.unknown()) }),
    )
    .optional(),
});

const ParamRefSchema: z.ZodType<ParamRef> = z.object({
  $param: z.string().min(1),
});

const TextNodeSchema: z.ZodType<TextNode> = z.strictObject({
  $text: z.string().min(1),
});

/**
 * Key-routed parse instead of `z.union`: a malformed node yields the
 * issues of the *one* branch its `$`-key selects (with a full path),
 * not a four-branch union explosion. The MCP layer surfaces these
 * issues verbatim to agents, so error shape is part of the tool UX.
 */
export const NodeSchema: z.ZodType<Node> = z
  .unknown()
  .transform((val, ctx): Node => {
    if (val === null || typeof val !== "object" || Array.isArray(val)) {
      ctx.addIssue({
        code: "custom",
        message:
          'node must be an object with one of "$ref" (component), "$snippet" (instance), "$param" (param ref), or "$text" (text beside elements)',
      });
      return z.NEVER;
    }
    const v = val as Record<string, unknown>;
    const branch =
      typeof v.$ref === "string"
        ? ComponentNodeSchema
        : typeof v.$snippet === "string"
          ? SnippetInstanceSchema
          : typeof v.$param === "string"
            ? ParamRefSchema
            : typeof v.$text === "string"
              ? TextNodeSchema
              : null;
    if (!branch) {
      ctx.addIssue({
        code: "custom",
        message:
          'node needs exactly one of "$ref" (component), "$snippet" (snippet instance), "$param" (param ref, snippet bodies only), or "$text" (text beside elements)',
      });
      return z.NEVER;
    }
    const parsed = branch.safeParse(val);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue });
      }
      return z.NEVER;
    }
    return parsed.data;
  })
  // Kept short on purpose: this string is inlined into five tools' schemas, so
  // every character is paid five times by every session. The full shapes —
  // $overrides, $extraClassName, $if, param placement — are in
  // velloo://guide/components and velloo://guide/snippets.
  .describe(
    '{"$ref":"Button","$id?":"cta","props?":{...},"children?":[Node]}, or {"$snippet":"<id>","args?":{...}}. Guide: velloo://guide/components',
  )
  // `z.unknown()` emits a JSON Schema with no `type`, so strict MCP clients
  // can't tell `tree`/`children` params are objects and serialize them as
  // strings — the server then rejects a valid `{"$ref":"Box"}`. The runtime
  // transform above still does the real validation; this only annotates the
  // emitted schema so clients send objects. Keep it as `additionalProperties:
  // true` (any object) rather than the full union — minimal and permissive.
  // Unavoidable cast: `.transform().meta()` erases the recursive output type
  // (ZodPipe of unknown), so reassert the declared `z.ZodType<Node>`.
  .meta({ type: "object", additionalProperties: true }) as unknown as z.ZodType<Node>;

/**
 * Read the `$id` of a node, if any. Convenience wrapper so callers don't
 * have to narrow by node kind first.
 */
export function nodeId(n: Node): string | undefined {
  if (isParamRef(n) || isTextNode(n)) return undefined;
  return (n as { $id?: string }).$id;
}
