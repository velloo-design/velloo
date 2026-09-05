import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isComponentNode, isSnippetInstance } from "@velloo/schema";
import { z } from "zod";
import {
  addNode,
  instantiateSnippet,
  type MutationContext,
  setScreenTree,
} from "../../mutations/index.ts";
import { propWarningsForTree } from "../../mutations/prop-warnings.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { diagnosticsForScreen } from "../diagnostics.ts";
import { compileRestrictedJsx, type JsxIssue } from "../restricted-jsx.ts";
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
        "Append one subtree or replace a screen tree using safe restricted JSX. Tags resolve automatically across the screen's library, extensions, and PascalCase snippet names. Supports nested tags, literal text, quoted props, and JSON literals in braces; no JavaScript executes. Use `vellooId` for a stable @id. Errors include line/column. Missing host-app packages never block design and are reported later by `emit_code.componentsToInstall`.",
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
      const compiled = await compileRestrictedJsx(ctx, screen, jsx);
      if (!compiled.ok)
        return sourceError("compose could not compile the restricted JSX", compiled.issues);

      let mutation:
        | Awaited<ReturnType<typeof setScreenTree>>
        | Awaited<ReturnType<typeof addNode>>
        | Awaited<ReturnType<typeof instantiateSnippet>>;
      if (mode === "replace") {
        mutation = await setScreenTree(ctx, { screenId, tree: compiled.node });
      } else if (isComponentNode(compiled.node)) {
        mutation = await addNode(ctx, {
          screenId,
          parentPath: parentPath ?? [],
          componentRef: compiled.node.$ref,
          ...(compiled.node.$id ? { id: compiled.node.$id } : {}),
          ...(compiled.node.props ? { props: compiled.node.props } : {}),
          ...(compiled.node.children ? { children: compiled.node.children } : {}),
          ...(index !== undefined ? { index } : {}),
        });
      } else if (isSnippetInstance(compiled.node)) {
        mutation = await instantiateSnippet(ctx, {
          screenId,
          parentPath: parentPath ?? [],
          snippetId: compiled.node.$snippet,
          ...(compiled.node.$id ? { id: compiled.node.$id } : {}),
          ...(compiled.node.args ? { args: compiled.node.args } : {}),
          ...(compiled.node.$extraClassName
            ? { extraClassName: compiled.node.$extraClassName }
            : {}),
          ...(index !== undefined ? { index } : {}),
        });
      } else {
        return sourceError("compose root must be a component or snippet", [
          {
            message: "Parameter references are only valid inside snippet definitions",
            offset: 0,
            line: 1,
            column: 1,
          },
        ]);
      }
      if (!mutation.ok) return toMcp(mutation);

      const resulting = ctx.folder.screens.get(screenId);
      const [propWarnings, diagnostics] = await Promise.all([
        resulting && isComponentNode(compiled.node)
          ? propWarningsForTree(ctx, resulting, compiled.node).catch(() => [])
          : [],
        resulting ? diagnosticsForScreen(ctx, jit, resulting).catch(() => []) : [],
      ]);
      return jsonResult({
        mode,
        ...mutation.value,
        root: isComponentNode(compiled.node)
          ? { kind: "component", id: compiled.node.$ref }
          : isSnippetInstance(compiled.node)
            ? { kind: "snippet", id: compiled.node.$snippet }
            : { kind: "unknown" },
        ...(propWarnings.length > 0 ? { propWarnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );
}
