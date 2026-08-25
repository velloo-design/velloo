import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import { validateClassNames } from "../../styles/class-validation.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function registerValidateTools(
  mcp: McpServer,
  ctx: MutationContext,
  jit: TailwindJit,
): void {
  mcp.registerTool(
    "validate_classes",
    {
      description:
        "Check whether each Tailwind class compiles under the active JIT — theme-aware: it knows the folder's palette/font tokens (`bg-ink`, `text-bone`, `font-display`) and classes defined in `custom_css`, not just stock Tailwind. Useful before relying on arbitrary-value forms like `shadow-[0_2px_8px_rgba(0,0,0,0.1)]` or `bg-[#fa00ff]`. Returns one report per input class with valid: true/false and a short reason on failure.",
      inputSchema: {
        classes: z.array(z.string()).min(1),
      },
    },
    async ({ classes }) => {
      const reports = await validateClassNames(jit, ctx.folder.customCss, classes);
      return jsonResult({ reports });
    },
  );
}
