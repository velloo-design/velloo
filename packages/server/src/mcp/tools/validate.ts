import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { entryCssPath } from "@velloo/shadcn-snapshot";
import { z } from "zod";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

let designSystemPromise: Promise<DesignSystem> | null = null;

function getDesignSystem(): Promise<DesignSystem> {
  if (designSystemPromise) return designSystemPromise;
  designSystemPromise = (async () => {
    const css = await readFile(entryCssPath, "utf8");
    return __unstable__loadDesignSystem(css, { base: dirname(entryCssPath) });
  })();
  return designSystemPromise;
}

interface ClassReport {
  class: string;
  valid: boolean;
  reason?: string;
}

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerValidateTools(mcp: McpServer): void {
  mcp.registerTool(
    "validate_classes",
    {
      description:
        "Check whether each Tailwind class compiles under the active JIT. Useful before relying on arbitrary-value forms like `shadow-[0_2px_8px_rgba(0,0,0,0.1)]` or `bg-[#fa00ff]`. Returns one report per input class with valid: true/false and a short reason on failure.",
      inputSchema: {
        classes: z.array(z.string()).min(1),
      },
    },
    async ({ classes }) => {
      const ds = await getDesignSystem();
      const reports: ClassReport[] = classes.map((cls) => {
        const trimmed = cls.trim();
        if (trimmed === "") return { class: cls, valid: false, reason: "empty class" };
        try {
          // parseCandidate returns one or more candidate AST entries; an unknown
          // class produces an empty result.
          const parsed = ds.parseCandidate(trimmed);
          if (parsed.length === 0) {
            return { class: cls, valid: false, reason: "no matching Tailwind utility" };
          }
          // Generation can still fail (e.g. variant on a non-utility); check
          // that the candidate produces CSS.
          const css = ds.candidatesToCss([trimmed]);
          if (css[0] === null) {
            return { class: cls, valid: false, reason: "candidate produced no CSS" };
          }
          return { class: cls, valid: true };
        } catch (err) {
          return {
            class: cls,
            valid: false,
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      });
      return jsonResult({ reports });
    },
  );
}
