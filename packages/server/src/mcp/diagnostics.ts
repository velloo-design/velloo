import { detectTailwindMajor, v3ClassIssues } from "@velloo/codegen";
import { styleChannelOf } from "@velloo/provider";
import { isComponentNode, type Node, type Screen, type Snippet } from "@velloo/schema";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import type { MutationContext } from "../mutations/context.ts";
import { darkModeAuditTree } from "../mutations/dark-mode-audit.ts";
import { providerForScreen } from "../mutations/lookup.ts";
import { validateClassNames } from "../styles/class-validation.ts";
import type { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * A compact, LSP-shaped problem returned beside the mutation/render that found
 * it. Diagnostics are advisory: the write already landed, and an empty array is
 * omitted from the MCP result entirely.
 */
export interface DesignDiagnostic {
  severity: "warning";
  code: "tailwind/invalid-class" | "tailwind/undefined-var" | "tailwind/v3" | "theme/raw-color";
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

  for (const problem of darkModeAuditTree(root).problems) {
    diagnostics.push({
      severity: "warning",
      code: "theme/raw-color",
      path: [...prefix, ...problem.path],
      message: `${problem.ref} uses non-flipping color classes: ${problem.raw.join(", ")}`,
      ...(Object.keys(problem.suggestions).length
        ? {
            suggestion: Object.entries(problem.suggestions)
              .map(([from, to]) => `${from} → ${to}`)
              .join(", "),
          }
        : {}),
    });
  }

  return diagnostics;
}

export function diagnosticsForScreen(
  ctx: MutationContext,
  jit: TailwindJit | undefined,
  screen: Screen,
): Promise<DesignDiagnostic[]> {
  return diagnosticsForTree(ctx, jit, screen, screen.tree);
}
