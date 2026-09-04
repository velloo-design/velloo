import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { detectTailwindMajor, v3ClassIssues } from "@velloo/codegen";
import { z } from "zod";
import { hostAppRootFrom } from "../../live/bundle-core.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { validateClassNames } from "../../styles/class-validation.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";
import { jsonResult } from "./result.ts";

export function registerValidateTools(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
): void {
  mcp.registerTool(
    "validate_classes",
    {
      description:
        "Check whether each Tailwind class compiles under the active JIT — theme-aware, so it knows the folder's palette and font tokens (`bg-ink`, `font-display`) and any `customCss` classes, not just stock Tailwind. Reach for it before relying on arbitrary-value forms like `bg-[#fa00ff]`. Returns valid + a reason per class.",
      inputSchema: {
        classes: z.array(z.string()).min(1),
      },
    },
    async ({ classes }) => {
      const reports = await validateClassNames(jit, ctx.folder.customCss, classes);
      // The canvas always compiles v4; when the host app is v3, layer the
      // downlevel advisory on top so a class that's fine on the canvas but
      // wrong in the app gets flagged at design time, not at emit time.
      const hostRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
      if (detectTailwindMajor(hostRoot) === 3) {
        const issues = new Map(v3ClassIssues(classes).map((i) => [i.class, i]));
        for (const report of reports) {
          const issue = issues.get(report.class);
          if (!issue) continue;
          const advice = issue.v3 ? `use \`${issue.v3}\` in the app — ${issue.note}` : issue.note;
          const warning = `host app is Tailwind v3: ${advice}`;
          report.warning = report.warning ? `${report.warning}; ${warning}` : warning;
        }
      }
      return jsonResult({ reports });
    },
  );
}
