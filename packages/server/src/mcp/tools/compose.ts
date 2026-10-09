import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isComponentNode,
  isSnippetInstance,
  type Node,
  type Screen,
  type Viewport,
} from "@velloo/schema";
import { z } from "zod";
import { qualifyAppComponents } from "../../mutations/component-refs.ts";
import { invalidPath, nearestRefs } from "../../mutations/errors.ts";
import {
  addBoard,
  addFrame,
  addNode,
  addScreen,
  instantiateSnippet,
  type MutationContext,
  setScreenTree,
  updateFrames,
} from "../../mutations/index.ts";
import { propWarningsForTree } from "../../mutations/prop-warnings.ts";
import { resolveLocator } from "../../path.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { diagnosticsForScreen } from "../diagnostics.ts";
import {
  compileRestrictedJsx,
  compileRestrictedJsxRoots,
  hostRootOf,
  type JsxIssue,
  readHostSource,
} from "../restricted-jsx.ts";
import { errorResult, jsonResult, type McpResult, toMcp } from "./result.ts";
import { PathSchema } from "./schemas.ts";
import { defaultViewport } from "./screenshot-helpers.ts";

function sourceError(message: string, issues: JsxIssue[]) {
  return errorResult({ kind: "BadRequest", message, issues });
}

/**
 * How tall a screen renders at a viewport, when the session can find out
 * (`measureContentHeight`). Absent in a context with no capture pipeline.
 */
export type MeasureScreen = (screen: Screen, viewport: Viewport) => Promise<number | null>;

export function registerComposeTool(
  mcp: McpServer,
  ctx: MutationContext,
  jit?: TailwindJit,
  measure?: MeasureScreen,
): void {
  // Frames compose itself placed, by the height it last gave them. Such a
  // frame keeps fitting its screen as the screen is rewritten — until someone
  // sizes it, at which point the height is theirs and stays.
  const fitted = new Map<string, number>();
  /**
   * Size the frames compose placed for `screenId` to what the screen now
   * renders. A page rarely fits a viewport's height, and a frame that clips it
   * sent every run back for an `update_frame` after its first capture.
   */
  const fitFrames = async (screenId: string): Promise<{ frame: string; h: number }[]> => {
    const screen = ctx.folder.screens.get(screenId);
    if (!measure || !screen) return [];
    const out: { frame: string; h: number }[] = [];
    for (const board of ctx.folder.boards.values()) {
      for (const frame of board.frames) {
        const key = `${board.id}/${frame.id}`;
        if (frame.screen !== screenId || fitted.get(key) !== frame.h) continue;
        const height = await measure(screen, { w: frame.w, h: defaultViewport(ctx.folder).h });
        const h = height === null ? frame.h : Math.max(defaultViewport(ctx.folder).h, height);
        if (h === frame.h) continue;
        const resized = await updateFrames(ctx, {
          boardId: board.id,
          patches: [{ frameId: frame.id, patch: { h } }],
        });
        if (!resized.ok) continue;
        fitted.set(key, h);
        out.push({ frame: frame.id, h });
      }
    }
    return out;
  };

  mcp.registerTool(
    "compose",
    {
      description:
        "Write JSX onto a screen: append subtrees (a fragment's roots become siblings), replace the whole tree (creating the screen on a board if `screenId` is new), or replace one node (`path`). Send the JSX you would write for the app, or the `file` that holds it: `const` data, `.map`, `cond && <X />`, `cn(...)`, components defined in the source, a whole page file. It is read as data and written out as elements; nothing executes — handlers are dropped and reported, data imported from the app's files is read from them, anything else (a fetch) is refused by name. Tags resolve across the screen's library, extensions, PascalCase snippet names, the app's own components (list_components' repo catalog, e.g. `Tabs.List`) and lowercase HTML. Use `vellooId` for a stable @id. Errors include line/column. `get_screen { mode: \"jsx\" }` returns this form to edit and send back. Missing host-app packages never block design; emit_code.componentsToInstall reports them.",
      inputSchema: {
        screenId: z.string(),
        mode: z.enum(["append", "replace"]),
        jsx: z.string().min(1).optional(),
        file: z
          .string()
          .min(1)
          .optional()
          .describe("An app file to read the JSX from, relative to the app root"),
        parentPath: PathSchema.optional().describe("append only; default [] (the root node)"),
        index: z.number().int().nonnegative().optional().describe("append only"),
        path: PathSchema.optional().describe(
          'replace only: the node to replace (a path or "@id"); default the whole tree',
        ),
      },
    },
    async ({ screenId, mode, jsx: sent, file, parentPath, index, path }) => {
      if ((sent === undefined) === (file === undefined)) {
        return sourceError("compose takes the JSX itself or a file to read it from", [
          { message: "Pass exactly one of `jsx` and `file`", offset: 0, line: 1, column: 1 },
        ]);
      }
      const read =
        file === undefined ? null : readHostSource(hostRootOf(ctx), resolve(hostRootOf(ctx), file));
      if (file !== undefined && read === null) {
        return sourceError(`compose could not read "${file}"`, [
          {
            message:
              "`file` is a .jsx/.tsx/.js/.ts file inside the app, given relative to the app root",
            offset: 0,
            line: 1,
            column: 1,
          },
        ]);
      }
      const jsx = read?.source ?? sent ?? "";
      const from = read ? { file: read.file } : {};
      const existing = ctx.folder.screens.get(screenId);
      // Replacing the whole tree of a screen that isn't there yet is making
      // the screen: one call puts a page on the canvas, where it used to take
      // add_board, add_screen and add_frame before the first compose.
      const made =
        !existing && mode === "replace" && path === undefined
          ? await makeScreen(ctx, screenId)
          : null;
      if (made && "error" in made) return made.error;
      if (made) fitted.set(`${made.created.board}/${made.created.frame}`, made.created.h);
      const screen = existing ?? made?.screen;
      if (!screen) return errorResult({ kind: "ScreenNotFound", screenId });
      if (mode === "replace" && (parentPath !== undefined || index !== undefined)) {
        return sourceError("compose replace does not accept parentPath or index", [
          {
            message: "Remove append-only arguments; to replace one node, name it with `path`",
            offset: 0,
            line: 1,
            column: 1,
          },
        ]);
      }
      if (mode === "append" && path !== undefined) {
        return sourceError("compose append takes parentPath, not path", [
          { message: "`path` names the node a replace swaps out", offset: 0, line: 1, column: 1 },
        ]);
      }
      const target = path === undefined ? [] : resolveLocator(screen.tree, path);
      if (target === null) {
        return errorResult(
          invalidPath(`No node at ${JSON.stringify(path)} in screen "${screenId}".`),
        );
      }
      const compiled =
        mode === "replace"
          ? await compileRestrictedJsx(ctx, screen, jsx, from).then((r) =>
              r.ok ? { ok: true as const, nodes: [r.node], notes: r.notes } : r,
            )
          : await compileRestrictedJsxRoots(ctx, screen, jsx, from);
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
        const replaced = await setScreenTree(ctx, {
          screenId,
          tree: target.length === 0 ? first : withNodeAt(screen.tree, target, first),
        });
        if (!replaced.ok) return toMcp(replaced);
        mutationValue =
          target.length === 0
            ? (replaced.value as unknown as Record<string, unknown>)
            : { screenId, path: target };
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
      const refit = mode === "replace" && target.length === 0 ? await fitFrames(screenId) : [];
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
        ...(made
          ? {
              created: {
                screen: made.created.screen,
                board: made.created.board,
                frame: made.created.frame,
                note: `"${screenId}" did not exist, so it was created and placed on the board "${made.created.board}", in a frame ${made.created.w}×${refit[0]?.h ?? made.created.h}${refit.length > 0 ? " sized to its content" : ""}.`,
              },
            }
          : refit.length > 0
            ? { framesFitted: refit }
            : {}),
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
        ...(compiled.notes.length > 0 ? { sourceNotes: compiled.notes } : {}),
        ...(propWarnings.length > 0 ? { propWarnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      });
    },
  );
}

/**
 * Create `screenId` and give it a frame, for a compose that names a screen the
 * folder doesn't have. Only for an id already shaped like one, and not when it
 * is a near miss of a screen that exists — a typo should hear about it rather
 * than quietly start a second screen.
 */
async function makeScreen(
  ctx: MutationContext,
  screenId: string,
): Promise<
  | {
      screen: Screen;
      created: { screen: string; board: string; frame: string; w: number; h: number };
    }
  | { error: McpResult }
  | null
> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(screenId)) return null;
  const near = nearestRefs(screenId, [...ctx.folder.screens.keys()], 1).filter(
    (id) =>
      Math.abs(id.length - screenId.length) <= 2 &&
      sharedPrefix(id, screenId) >= screenId.length - 2,
  );
  if (near.length > 0) {
    return {
      error: errorResult({
        kind: "ScreenNotFound",
        screenId,
        suggestions: near,
        hint: `Did you mean "${near[0]}"? A compose in mode "replace" creates a screen that doesn't exist; this id is one edit from an existing one, so nothing was created. Call add_screen to make it on purpose.`,
      }),
    };
  }
  const name = screenId
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
  const added = await addScreen(ctx, { name, id: screenId });
  if (!added.ok) return { error: toMcp(added) };
  // The board the user is already looking at, or the folder's first.
  const live = [...ctx.folder.boards.values()].filter((board) => !board.archivedAt);
  let boardId =
    live.find((board) => board.id === ctx.folder.config.defaultBoard)?.id ?? live[0]?.id;
  if (boardId === undefined) {
    const board = await addBoard(ctx, { name: "Screens" });
    if (!board.ok) return { error: toMcp(board) };
    boardId = board.value.boardId;
  }
  const viewport = defaultViewport(ctx.folder);
  const frame = await addFrame(ctx, { boardId, screenId, w: viewport.w, h: viewport.h });
  if (!frame.ok) return { error: toMcp(frame) };
  return {
    screen: added.value.screen,
    created: {
      screen: screenId,
      board: boardId,
      frame: frame.value.frame.id,
      w: viewport.w,
      h: viewport.h,
    },
  };
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/** `root` with the node at `path` (not the root itself) swapped for `node`. */
function withNodeAt(root: Node, path: number[], node: Node): Node {
  const [index, ...rest] = path;
  if (index === undefined || !isComponentNode(root)) return node;
  const children = [...(root.children ?? [])];
  const child = children[index];
  if (child === undefined) return root;
  children[index] = rest.length === 0 ? node : withNodeAt(child, rest, node);
  return { ...root, children };
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
