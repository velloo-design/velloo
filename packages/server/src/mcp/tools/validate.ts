import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { z } from "zod";
import type { MutationContext } from "../../mutations/index.ts";
import type { TailwindJit } from "../../styles/tailwind-jit.ts";

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

let designSystemPromise: Promise<DesignSystem> | null = null;
let designSystemKey: string | null = null;

/**
 * Load the Tailwind v4 design system for class-candidate parsing — from the
 * SAME merged entry CSS the JIT compiles against (providers + the theme's
 * `@theme` block), so theme-injected utilities like `bg-ink` / `font-display`
 * resolve instead of reading as invalid. Keyed on the CSS itself, so a
 * `set_token` / `set_fonts` edit transparently rebuilds.
 */
function getDesignSystem(jit: TailwindJit): Promise<DesignSystem> {
  return jit.entryCss().then(({ css, base }) => {
    if (designSystemPromise && designSystemKey === css) return designSystemPromise;
    designSystemKey = css;
    designSystemPromise = __unstable__loadDesignSystem(css, { base });
    return designSystemPromise;
  });
}

/**
 * Whether `cls` is defined as a literal class selector in the folder's
 * `custom_css`. Tailwind's design system only knows utilities + `@theme`
 * tokens, so a hand-authored rule like `.shadow-lift { … }` (which the
 * renderer injects verbatim and paints) would otherwise read as invalid.
 * Identifier-like classes only — arbitrary-value forms aren't hand-written.
 */
function definedInCustomCss(customCss: string | undefined, cls: string): boolean {
  if (!customCss || !/^[a-z][a-z0-9:_-]*$/i.test(cls)) return false;
  const escaped = cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])`).test(customCss);
}

interface ClassReport {
  class: string;
  valid: boolean;
  reason?: string;
}

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
      const ds = await getDesignSystem(jit);
      const reports: ClassReport[] = classes.map((cls) => {
        const trimmed = cls.trim();
        if (trimmed === "") return { class: cls, valid: false, reason: "empty class" };
        try {
          // parseCandidate returns one or more candidate AST entries; an unknown
          // class produces an empty result.
          const parsed = ds.parseCandidate(trimmed);
          if (parsed.length > 0) {
            // Generation can still fail (e.g. variant on a non-utility); check
            // that the candidate produces CSS.
            const css = ds.candidatesToCss([trimmed]);
            if (css[0] !== null) return { class: cls, valid: true };
          }
          // Not a Tailwind utility — but a custom_css rule may still define it.
          if (definedInCustomCss(ctx.folder.customCss, trimmed)) {
            return {
              class: cls,
              valid: true,
              reason: "defined in custom_css (not a Tailwind utility)",
            };
          }
          return {
            class: cls,
            valid: false,
            reason:
              parsed.length === 0 ? "no matching Tailwind utility" : "candidate produced no CSS",
          };
        } catch (err) {
          if (definedInCustomCss(ctx.folder.customCss, trimmed)) {
            return {
              class: cls,
              valid: true,
              reason: "defined in custom_css (not a Tailwind utility)",
            };
          }
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
