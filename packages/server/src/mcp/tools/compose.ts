import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isComponentNode, isSnippetInstance, type Node } from "@velloo/schema";
import { z } from "zod";
import { qualifyAppComponents } from "../../mutations/component-refs.ts";
import {
  addNode,
  instantiateSnippet,
  type MutationContext,
  setScreenTree,
} from "../../mutations/index.ts";
import { propWarningsForTree } from "../../mutations/prop-warnings.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { diagnosticsForScreen } from "../diagnostics.ts";
import {
  compileRestrictedJsx,
  compileRestrictedJsxRoots,
  type JsxIssue,
} from "../restricted-jsx.ts";
import { errorResult, jsonResult, toMcp } from "./result.ts";
import { PathSchema } from "./schemas.ts";

function sourceError(message: string, issues: JsxIssue[]) {
  return errorResult({ kind: "BadRequest", message, issues });
}

export function registerComposeTool(mcp: McpServer, ctx: MutationContext, jit?: TailwindJit): void {
  mcp.registerTool(
    "compose",
    {
      description:
        "Append subtrees (a fragment's roots become siblings) or replace a screen tree with safe restricted JSX. Tags resolve across the screen's library, extensions, PascalCase snippet names, the app's own components (list_components' repo catalog, e.g. `Tabs.List`) and lowercase HTML. Supports nesting, text, quoted props, JSON literals in braces, and an element as a prop (`leftSection={<Icon name=\"bolt\" />}`); no JavaScript executes. Use `vellooId` for a stable @id. Errors include line/column. Missing host-app packages never block design; emit_code.componentsToInstall reports them.",
      inputSchema: {
        screenId: z.string(),
        mode: z.enum(["append", "replace"]),
        jsx: z.string().min(1),
        parentPath: PathSchema.optional().describe("append only; default [] (the root node)"),
        index: z.number().int().nonnegative().optional().describe("append only"),
      },
    },
    async ({ screenId, mode, jsx, parentPath, index }) => {
      const screen = ctx.folder.screens.get(screenId);
      if (!screen) return errorResult({ kind: "ScreenNotFound", screenId });
      if (mode === "replace" && (parentPath !== undefined || index !== undefined)) {
        return sourceError("compose replace does not accept parentPath or index", [
          { message: "Remove append-only arguments", offset: 0, line: 1, column: 1 },
        ]);
      }
      const compiled =
        mode === "replace"
          ? await compileRestrictedJsx(ctx, screen, jsx).then((r) =>
              r.ok ? { ok: true as const, nodes: [r.node] } : r,
            )
          : await compileRestrictedJsxRoots(ctx, screen, jsx);
      if (!compiled.ok)
        return sourceError("compose could not compile the restricted JSX", compiled.issues);

      type Written =
        | Awaited<ReturnType<typeof addNode>>
        | Awaited<ReturnType<typeof instantiateSnippet>>;
      const append = async (node: Node, at: number | undefined): Promise<Written | null> => {
        if (isComponentNode(node)) {
          return addNode(ctx, {
            screenId,
            parentPath: parentPath ?? [],
            componentRef: node.$ref,
            ...(node.$id ? { id: node.$id } : {}),
            ...(node.props ? { props: node.props } : {}),
            ...(node.children ? { children: node.children } : {}),
            ...(node.$repo ? { repo: node.$repo } : {}),
            ...(at !== undefined ? { index: at } : {}),
          });
        }
        if (isSnippetInstance(node)) {
          return instantiateSnippet(ctx, {
            screenId,
            parentPath: parentPath ?? [],
            snippetId: node.$snippet,
            ...(node.$id ? { id: node.$id } : {}),
            ...(node.args ? { args: node.args } : {}),
            ...(node.$extraClassName ? { extraClassName: node.$extraClassName } : {}),
            ...(at !== undefined ? { index: at } : {}),
          });
        }
        return null;
      };

      // A bare name given the app's props, where only one app component of
      // that name takes them: written as that component, and reported below.
      const { value: nodes, qualified } = await qualifyAppComponents(ctx, compiled.nodes, screen);
      const first = nodes[0] as Node;
      let mutationValue: Record<string, unknown>;
      if (mode === "replace") {
        const replaced = await setScreenTree(ctx, { screenId, tree: first });
        if (!replaced.ok) return toMcp(replaced);
        mutationValue = replaced.value as unknown as Record<string, unknown>;
      } else {
        // Several roots land as consecutive siblings, in source order.
        const written: Record<string, unknown>[] = [];
        for (const [i, node] of nodes.entries()) {
          const result = await append(node, index === undefined ? undefined : index + i);
          if (result === null) {
            return sourceError("compose root must be a component or snippet", [
              {
                message: "Parameter references are only valid inside snippet definitions",
                offset: 0,
                line: 1,
                column: 1,
              },
            ]);
          }
          if (!result.ok) {
            if (written.length === 0) return toMcp(result);
            return errorResult({
              kind: "BadRequest",
              message: `compose added ${written.length} of ${nodes.length} roots, then failed; the first ${written.length} were kept.`,
              added: written,
              error: result.error,
            });
          }
          written.push(result.value as unknown as Record<string, unknown>);
        }
        mutationValue =
          written.length === 1 ? (written[0] as Record<string, unknown>) : { added: written };
      }
      const resulting = ctx.folder.screens.get(screenId);
      const [propWarnings, diagnostics] = await Promise.all([
        resulting
          ? Promise.all(
              nodes
                .filter(isComponentNode)
                .map((node) => propWarningsForTree(ctx, resulting, node).catch(() => [])),
            ).then((lists) => lists.flat())
          : [],
        resulting ? diagnosticsForScreen(ctx, jit, resulting).catch(() => []) : [],
      ]);
      const rootOf = (node: Node) =>
        isComponentNode(node)
          ? { kind: "component", id: node.$ref }
          : isSnippetInstance(node)
            ? { kind: "snippet", id: node.$snippet }
            : { kind: "unknown" };
      // Where an append landed, in the markup's own words: an agent that
      // replaced the tree with its hero reads `into: <div class="hero">` and
      // sees at once that the page's sections went inside it.
      const firstPath = (written: unknown) => {
        const path = (written as { path?: unknown } | undefined)?.path;
        return Array.isArray(path) ? (path as number[]) : undefined;
      };
      const landed =
        mode === "append"
          ? (firstPath(mutationValue) ??
            firstPath((mutationValue as { added?: unknown[] }).added?.[0]))
          : undefined;
      const into = landed && resulting ? describeNodeAt(resulting.tree, landed.slice(0, -1)) : null;
      return jsonResult({
        mode,
        ...mutationValue,
        ...(into ? { into } : {}),
        ...(nodes.length === 1 ? { root: rootOf(first) } : { roots: nodes.map(rootOf) }),
        ...(qualified.length > 0
          ? {
              appComponents: {
                note: "A bare name is Velloo's own component. These passed props only the app's same-named component takes, so they were written as the app's — write the qualified name to say so, or drop those props to keep Velloo's.",
                read: qualified,
              },
            }
          : {}),
        ...(propWarnings.length > 0 ? { propWarnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );
}

/** `<div class="hero">` for the node at `path` — its element and classes, nothing else. */
function describeNodeAt(root: Node, path: number[]): string | null {
  let node: Node | undefined = root;
  for (const index of path) {
    node = node && isComponentNode(node) ? node.children?.[index] : undefined;
  }
  if (!node) return null;
  if (!isComponentNode(node)) return isSnippetInstance(node) ? `<${node.$snippet}>` : null;
  const props = node.props ?? {};
  const tag = typeof props.as === "string" ? props.as : node.$ref;
  const classes = props.className ?? props.class;
  return typeof classes === "string" && classes.trim() !== ""
    ? `<${tag} class="${classes.trim()}">`
    : `<${tag}>`;
}
