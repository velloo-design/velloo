import { detectTailwindMajor, v3ClassIssues } from "@velloo/codegen";
import { styleChannelOf } from "@velloo/provider";
import { type RenderFailure, renderBodyGuarded } from "@velloo/renderer";
import { isComponentNode, type Node, type Screen, type Snippet } from "@velloo/schema";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { MutationContext } from "../mutations/context.ts";
import { darkModeAuditTree } from "../mutations/dark-mode-audit.ts";
import { providerForScreen, registryForScreen } from "../mutations/lookup.ts";
import { validateClassNames } from "../styles/class-validation.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * A compact, LSP-shaped problem returned beside the mutation/render that found
 * it. Diagnostics are advisory: the write already landed, and an empty array is
 * omitted from the MCP result entirely.
 */
export interface DesignDiagnostic {
  severity: "warning" | "error";
  code:
    | "tailwind/invalid-class"
    | "tailwind/undefined-var"
    | "tailwind/v3"
    | "theme/raw-color"
    | "render/component-threw"
    | "render/component-missing"
    | "render/server-fallback";
  path: number[];
  message: string;
  suggestion?: string | undefined;
}

type StyledThing = Pick<Screen, "library"> | Pick<Snippet, "library">;

interface ClassUse {
  path: number[];
  className: string;
  classes: string[];
}

function classUses(root: Node, prefix: number[]): ClassUse[] {
  const out: ClassUse[] = [];
  const walk = (node: Node, path: number[]): void => {
    if (!isComponentNode(node)) return;
    const className = typeof node.props?.className === "string" ? node.props.className.trim() : "";
    if (className) out.push({ path, className, classes: className.split(/\s+/).filter(Boolean) });
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const child = node.children?.[i];
      if (child) walk(child, [...path, i]);
    }
  };
  walk(root, prefix);
  return out;
}

/**
 * How many raw-color warnings are worth listing individually. Past this the
 * list stops being a set of things to fix and becomes one repeated observation.
 */
const RAW_COLOR_LIMIT = 8;

/**
 * Validate the Tailwind classes and theme-flipping behavior of one changed
 * tree. Non-Tailwind providers return no diagnostics: their `sx`/`style`
 * channels are validated by their component/runtime layer instead.
 */
export async function diagnosticsForTree(
  ctx: MutationContext,
  jit: TailwindJit | undefined,
  thing: StyledThing,
  root: Node,
  prefix: number[] = [],
): Promise<DesignDiagnostic[]> {
  if (!jit) return [];
  const channel = styleChannelOf(
    providerForScreen(ctx, thing),
    ctx.folder.config.styling?.framework,
  );
  if (!channel.needsTailwindJit) return [];

  const uses = classUses(root, prefix);
  const unique = [...new Set(uses.flatMap((use) => use.classes))];
  const reports = unique.length ? await validateClassNames(jit, ctx.folder.customCss, unique) : [];
  const reportByClass = new Map(reports.map((report) => [report.class, report]));
  const diagnostics: DesignDiagnostic[] = [];

  for (const use of uses) {
    for (const cls of use.classes) {
      const report = reportByClass.get(cls);
      if (!report) continue;
      if (!report.valid) {
        diagnostics.push({
          severity: "warning",
          code: "tailwind/invalid-class",
          path: use.path,
          message: `\`${cls}\` does not compile: ${report.reason ?? "no matching utility"}`,
        });
      } else if (report.warning) {
        diagnostics.push({
          severity: "warning",
          code: "tailwind/undefined-var",
          path: use.path,
          message: `\`${cls}\` ${report.warning}`,
        });
      }
    }
  }

  const hostRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
  if (detectTailwindMajor(hostRoot) === 3) {
    const issues = new Map(v3ClassIssues(unique).map((issue) => [issue.class, issue]));
    for (const use of uses) {
      for (const cls of use.classes) {
        const issue = issues.get(cls);
        if (!issue) continue;
        diagnostics.push({
          severity: "warning",
          code: "tailwind/v3",
          path: use.path,
          message: `\`${cls}\` uses Tailwind v4 semantics in a v3 host: ${issue.note}`,
          ...(issue.v3 ? { suggestion: issue.v3 } : {}),
        });
      }
    }
  }

  diagnostics.push(...rawColorDiagnostics(root, prefix));

  return diagnostics;
}

/**
 * Raw-color warnings, capped, with the opt-out named once at the end.
 *
 * One deliberate decision — white text over a photo scrim, a brand gradient —
 * produces one of these per node beneath it, because the `data-accent` opt-out
 * deliberately does not cascade. Thirty repetitions of a warning the agent has
 * already judged and rejected drown the diagnostics that matter, and the
 * suggestion attached to each (`text-white` → `text-foreground`) would break
 * the design if taken. The guide documents the opt-out; nothing did at the
 * point of the warning, which left comply-or-ignore as the visible options.
 */
export function rawColorDiagnostics(root: Node, prefix: number[] = []): DesignDiagnostic[] {
  const problems = darkModeAuditTree(root).problems;
  const out: DesignDiagnostic[] = problems.slice(0, RAW_COLOR_LIMIT).map((problem) => ({
    severity: "warning" as const,
    code: "theme/raw-color" as const,
    path: [...prefix, ...problem.path],
    message: `${problem.ref} uses non-flipping color classes: ${problem.raw.join(", ")}`,
    ...(Object.keys(problem.suggestions).length
      ? {
          suggestion: Object.entries(problem.suggestions)
            .map(([from, to]) => `${from} → ${to}`)
            .join(", "),
        }
      : {}),
  }));
  if (problems.length > RAW_COLOR_LIMIT) {
    out.push({
      severity: "warning",
      code: "theme/raw-color",
      path: [...prefix],
      message:
        `${problems.length - RAW_COLOR_LIMIT} more node(s) use non-flipping color classes. ` +
        `If these are deliberate — text over an image or scrim, a brand accent, chrome tuned for one mode — ` +
        `set \`data-accent: "ok"\` on each to exempt it, rather than taking a suggestion that would break the design. ` +
        `The opt-out does not cascade to children.`,
    });
  }
  return out;
}

/** Every path in the tree holding a node that renders `ref`. */
function pathsUsing(root: Node, ref: string): number[][] {
  const out: number[][] = [];
  const walk = (node: Node, path: number[]): void => {
    if (!isComponentNode(node)) return;
    if (node.$ref === ref) out.push(path);
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const child = node.children?.[i];
      if (child) walk(child, [...path, i]);
    }
  };
  walk(root, []);
  return out;
}

/**
 * Which components on the screen could not render — one that threw, and one
 * whose `$ref` names nothing in the library.
 *
 * The checks above read the tree; this one renders it, because a component
 * that throws is invisible to every check that does not — a Select part with
 * no Select above it, a prop the component dereferences. The canvas shows a
 * stand-in and a screenshot shows the box, but an agent composing a screen
 * only sees the mutation result, and a clean result says nothing is wrong.
 * That is doubly true of a missing `$ref`, whose only other symptom used to be
 * the whole screen refusing to draw.
 *
 * The whole screen renders, never the changed subtree on its own: out of
 * context any component reading a parent's context throws, and that failure
 * would be an artifact of the isolation rather than a fact about the design.
 */
export function renderDiagnostics(ctx: MutationContext, screen: Screen): DesignDiagnostic[] {
  let failures: RenderFailure[];
  try {
    failures = renderBodyGuarded(
      screen,
      registryForScreen(ctx, screen),
      ctx.folder.snippets,
    ).failures;
  } catch {
    // A throw the guard could not pin on one component. It surfaces elsewhere,
    // and the other diagnostics are still worth having.
    return [];
  }

  return failures.flatMap((failure) => {
    const paths = pathsUsing(screen.tree, failure.componentId);
    // A component reached only through a snippet body has no path on the
    // screen; report it at the root rather than dropping it.
    return (paths.length > 0 ? paths : [[]]).map(
      (path): DesignDiagnostic => ({
        severity: "error",
        path,
        ...(failure.kind === "missing"
          ? {
              code: "render/component-missing" as const,
              message: `\`${failure.componentId}\` is not in this screen's library, so it drew as a placeholder. Check the name against list_components, or register it with add_extension.`,
            }
          : {
              code: "render/component-threw" as const,
              message: `\`${failure.componentId}\` failed to render and was replaced with a placeholder: ${failure.reason}`,
            }),
      }),
    );
  });
}

export async function diagnosticsForScreen(
  ctx: MutationContext,
  jit: TailwindJit | undefined,
  screen: Screen,
): Promise<DesignDiagnostic[]> {
  return [
    ...renderDiagnostics(ctx, screen),
    ...(await diagnosticsForTree(ctx, jit, screen, screen.tree)),
  ];
}
