import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Progressive disclosure for the MCP tool surface. The server registers every
 * tool, then hides the long-tail *families* below so only a lean core is
 * advertised at boot — fewer schemas in the agent's context, fewer ways to
 * mis-select. A hidden tool is both absent from `tools/list` and rejects
 * calls. The `reveal_tools` meta-tool re-enables a family on demand; the SDK's
 * `enable()` fires `tools/list_changed`, so a compliant client re-fetches the
 * larger list automatically. `VELLOO_MCP_FLAT=1` opts out entirely (advertise
 * everything up front) for clients that don't honor `list_changed`.
 *
 * Keep families CONSERVATIVE: a tool belongs here only if the boot
 * instructions don't steer the agent to it in the main compose→verify→emit
 * loop. Names must match registered tool ids exactly — a drift is caught at
 * boot (see {@link applyDefaultTiers}'s `missing`).
 */

/** The slice of the SDK's `RegisteredTool` the disclosure tiers drive. */
export interface ToolHandle {
  enabled: boolean;
  enable(): void;
  disable(): void;
}

/** Tool id → its `RegisteredTool` handle, captured at registration time. */
export type ToolRegistry = Map<string, ToolHandle>;

interface Family {
  /** One-line summary shown in `reveal_tools`' description + the boot hint. */
  summary: string;
  /** Tool ids in this family — default-hidden until the family is revealed. */
  tools: readonly string[];
  /**
   * How-to returned by `reveal_tools` when the family unlocks, so the agent
   * gets the guidance exactly when the tools appear — not in the always-on
   * instructions where it would be noise for sessions that never need it.
   */
  guidance: string;
}

export const TOOL_FAMILIES = {
  "theme-authoring": {
    summary: "Author a theme from scratch — named presets, contrast scoring, extra named themes.",
    tools: ["add_theme", "apply_preset", "score_theme_contrast", "list_themes"],
    guidance:
      "From-scratch theme authoring. `apply_preset` swaps in a named starter palette; `score_theme_contrast` checks WCAG ratios; `add_theme` registers an additional named theme and `list_themes` enumerates them. To match an existing app, prefer `import_theme` (core); to build a palette from one seed color, `derive_palette_from_color` (core).",
  },
  lifecycle: {
    summary:
      "Delete or rename existing resources — boards, frames, groups, screens, snippets, extensions.",
    tools: [
      "remove_board",
      "remove_frame",
      "remove_group",
      "remove_screen",
      "remove_snippet",
      "remove_extension",
      "update_board",
      "update_group",
      "update_screen",
      "update_extension",
    ],
    guidance:
      "Destructive + rename CRUD for existing resources. `remove_*` deletes a resource (`remove_snippet` refuses with SnippetInUse if any screen instantiates it); `update_board`/`update_group`/`update_screen`/`update_extension` rename or retarget metadata. Node deletes (`remove_node`) and frame edits (`update_frame`) stay in the core surface.",
  },
  "annotations-write": {
    summary:
      "Post or remove your own (agent-authored) annotations. Reading designer annotations stays core.",
    tools: ["add_annotation", "remove_annotation"],
    guidance:
      'Pin your own annotations with `add_annotation` (author: "agent") — questions for the designer, review remarks — and delete your own with `remove_annotation`. User-authored annotations stay read-only. Reading (`list_annotations`) needs no reveal.',
  },
} satisfies Record<string, Family>;

export type FamilyName = keyof typeof TOOL_FAMILIES;

/** True when `VELLOO_MCP_FLAT` is set truthy — advertise every tool up front. */
export function flatToolsMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.VELLOO_MCP_FLAT;
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

/**
 * Wrap `registerTool` to (1) rewrap a raw input shape as `z.strictObject` so a
 * typo'd argument fails loudly instead of being silently dropped, and (2)
 * record each tool's handle for the disclosure tiers. Returns the registry.
 * Apply before `withCallRecording`; both chain via `return original(...)`, so
 * the captured handle propagates up unchanged.
 */
export function instrumentTools(mcp: McpServer): ToolRegistry {
  const registry: ToolRegistry = new Map();
  const original = mcp.registerTool.bind(mcp);
  const patched: typeof original = (name, config, cb) => {
    const input = (config as { inputSchema?: unknown }).inputSchema;
    const isRawShape =
      input !== undefined &&
      input !== null &&
      typeof input === "object" &&
      typeof (input as { safeParse?: unknown }).safeParse !== "function";
    const finalConfig = isRawShape
      ? ({
          ...config,
          inputSchema: z.strictObject(input as z.ZodRawShape),
        } as unknown as Parameters<typeof original>[1])
      : config;
    const handle = original(name, finalConfig, cb);
    registry.set(name, handle);
    return handle;
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;
  return registry;
}

/**
 * Hide every family tool so only the core surface is advertised. Returns the
 * tools actually hidden and any family name with no matching registered handle
 * — a programming drift (renamed/removed tool) the caller surfaces at boot.
 */
export function applyDefaultTiers(registry: ToolRegistry): {
  hidden: string[];
  missing: string[];
} {
  const hidden: string[] = [];
  const missing: string[] = [];
  for (const family of Object.values(TOOL_FAMILIES)) {
    for (const name of family.tools) {
      const handle = registry.get(name);
      if (!handle) {
        missing.push(name);
        continue;
      }
      handle.disable();
      hidden.push(name);
    }
  }
  return { hidden, missing };
}

/** Enable a family's tools (or all). Idempotent — already-on tools are reported, not re-enabled. */
export function revealFamily(
  registry: ToolRegistry,
  area: FamilyName | "all",
): { unlocked: string[]; alreadyOn: string[]; guidance: string[] } {
  const names: FamilyName[] =
    area === "all" ? (Object.keys(TOOL_FAMILIES) as FamilyName[]) : [area];
  const unlocked: string[] = [];
  const alreadyOn: string[] = [];
  const guidance: string[] = [];
  for (const family of names) {
    const def = TOOL_FAMILIES[family];
    guidance.push(`${family}: ${def.guidance}`);
    for (const name of def.tools) {
      const handle = registry.get(name);
      if (!handle) continue;
      if (handle.enabled) {
        alreadyOn.push(name);
      } else {
        handle.enable();
        unlocked.push(name);
      }
    }
  }
  return { unlocked, alreadyOn, guidance };
}

/** Register the always-on `reveal_tools` meta-tool. */
export function registerRevealTool(mcp: McpServer, registry: ToolRegistry): void {
  const areas = Object.keys(TOOL_FAMILIES) as FamilyName[];
  const familyList = areas.map((a) => `\`${a}\` — ${TOOL_FAMILIES[a].summary}`).join(" ");
  mcp.registerTool(
    "reveal_tools",
    {
      description: `Unlock a hidden tool family so its tools become callable — the core surface stays lean and this reveals more on demand (fires tools/list_changed; your client re-fetches the larger list). Families: ${familyList} Pass "all" to reveal every family. Idempotent.`,
      inputSchema: {
        area: z
          .enum([...areas, "all"] as unknown as [string, ...string[]])
          .describe('Tool family to reveal, or "all".'),
      },
    },
    async ({ area }) => {
      const { unlocked, alreadyOn, guidance } = revealFamily(registry, area as FamilyName | "all");
      const lines: string[] = [];
      if (unlocked.length > 0) lines.push(`Revealed (now callable): ${unlocked.join(", ")}.`);
      if (alreadyOn.length > 0) lines.push(`Already available: ${alreadyOn.join(", ")}.`);
      if (unlocked.length === 0 && alreadyOn.length === 0)
        lines.push("No tools matched that area.");
      lines.push("", ...guidance);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}

/** The boot-instruction paragraph teaching the agent that tools are revealed on demand. */
export function revealInstructions(): string {
  const families = (Object.keys(TOOL_FAMILIES) as FamilyName[])
    .map((a) => `\`${a}\` (${TOOL_FAMILIES[a].summary})`)
    .join(", ");
  return [
    `**Focused tool surface.** Velloo advertises a lean core covering the compose→verify→emit loop; less-common tools are grouped into families that stay hidden until you call \`reveal_tools({ area })\`, which unlocks them (your client re-fetches the tool list automatically). Families: ${families}.`,
    "If this guide names a tool you don't see in your tool list (e.g. `remove_screen`, `apply_preset`, `add_annotation`), it's behind `reveal_tools` — unlock its family, then call it. (Set `VELLOO_MCP_FLAT=1` to advertise every tool up front instead.)",
  ].join(" ");
}
