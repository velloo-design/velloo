import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildInstructions } from "../server.ts";
import {
  applyDefaultTiers,
  type FamilyName,
  flatToolsMode,
  instrumentTools,
  progressiveToolsMode,
  revealFamily,
  TOOL_FAMILIES,
  type ToolRegistry,
} from "../tiers.ts";

/** Synthetic handle registry — exercises the tier logic without the SDK. */
function fakeRegistry(names: string[]): ToolRegistry {
  const registry: ToolRegistry = new Map();
  for (const name of names) {
    let enabled = true;
    registry.set(name, {
      get enabled() {
        return enabled;
      },
      enable() {
        enabled = true;
      },
      disable() {
        enabled = false;
      },
    });
  }
  return registry;
}

const allFamilyTools = Object.values(TOOL_FAMILIES).flatMap((f) => f.tools);

describe("TOOL_FAMILIES", () => {
  test("families are non-empty and disjoint", () => {
    const seen = new Set<string>();
    for (const family of Object.values(TOOL_FAMILIES)) {
      expect(family.tools.length).toBeGreaterThan(0);
      for (const name of family.tools) {
        expect(seen.has(name)).toBe(false); // no tool in two families
        seen.add(name);
      }
    }
  });
});

describe("applyDefaultTiers", () => {
  test("hides exactly the family tools and leaves core enabled", () => {
    const registry = fakeRegistry([...allFamilyTools, "add_node", "emit_code", "reveal_tools"]);
    const { hidden, missing } = applyDefaultTiers(registry);

    expect(missing).toEqual([]);
    expect(new Set(hidden)).toEqual(new Set(allFamilyTools));
    for (const name of allFamilyTools) expect(registry.get(name)?.enabled).toBe(false);
    for (const core of ["add_node", "emit_code", "reveal_tools"]) {
      expect(registry.get(core)?.enabled).toBe(true);
    }
  });

  test("reports family tools with no registered handle (drift guard)", () => {
    const registry = fakeRegistry(allFamilyTools.filter((t) => t !== "remove_screen"));
    const { missing } = applyDefaultTiers(registry);
    expect(missing).toEqual(["remove_screen"]);
  });
});

describe("revealFamily", () => {
  test("re-enables one family, leaves the others hidden, returns its guidance", () => {
    const registry = fakeRegistry(allFamilyTools);
    applyDefaultTiers(registry);

    const { unlocked, alreadyOn, guidance } = revealFamily(registry, "lifecycle");

    expect(new Set(unlocked)).toEqual(new Set(TOOL_FAMILIES.lifecycle.tools));
    expect(alreadyOn).toEqual([]);
    expect(guidance.join("\n")).toContain("lifecycle:");
    for (const name of TOOL_FAMILIES.lifecycle.tools) {
      expect(registry.get(name)?.enabled).toBe(true);
    }
    // A different family stays hidden.
    expect(registry.get("add_theme")?.enabled).toBe(false);
  });

  test("is idempotent — a revealed family reports alreadyOn, not unlocked", () => {
    const registry = fakeRegistry(allFamilyTools);
    applyDefaultTiers(registry);
    revealFamily(registry, "annotations-write");
    const second = revealFamily(registry, "annotations-write");
    expect(second.unlocked).toEqual([]);
    expect(new Set(second.alreadyOn)).toEqual(new Set(TOOL_FAMILIES["annotations-write"].tools));
  });

  test('"all" reveals every family', () => {
    const registry = fakeRegistry(allFamilyTools);
    applyDefaultTiers(registry);
    revealFamily(registry, "all");
    for (const name of allFamilyTools) expect(registry.get(name)?.enabled).toBe(true);
  });
});

describe("flatToolsMode", () => {
  test("truthy values force flat", () => {
    for (const v of ["1", "true", "yes", "on"]) {
      expect(flatToolsMode({ VELLOO_MCP_FLAT: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  test("unset / falsy values do not force flat", () => {
    expect(flatToolsMode({} as NodeJS.ProcessEnv)).toBe(false);
    for (const v of ["", "0", "false", "FALSE"]) {
      expect(flatToolsMode({ VELLOO_MCP_FLAT: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });
});

describe("progressiveToolsMode", () => {
  test("default (no env) is flat — progressive off", () => {
    expect(progressiveToolsMode({} as NodeJS.ProcessEnv)).toBe(false);
  });

  test("VELLOO_MCP_PROGRESSIVE=1 opts into tiering", () => {
    for (const v of ["1", "true", "yes", "on"]) {
      expect(progressiveToolsMode({ VELLOO_MCP_PROGRESSIVE: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  test("falsy VELLOO_MCP_PROGRESSIVE stays flat", () => {
    for (const v of ["", "0", "false", "FALSE"]) {
      expect(progressiveToolsMode({ VELLOO_MCP_PROGRESSIVE: v } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  test("VELLOO_MCP_FLAT wins over VELLOO_MCP_PROGRESSIVE", () => {
    expect(
      progressiveToolsMode({
        VELLOO_MCP_PROGRESSIVE: "1",
        VELLOO_MCP_FLAT: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("real SDK handles", () => {
  test("a registered tool's handle satisfies ToolHandle and disable() hides it", () => {
    const mcp = new McpServer({ name: "t", version: "0" });
    const registry = instrumentTools(mcp);
    mcp.registerTool("remove_screen", { inputSchema: { id: z.string() } }, async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    const handle = registry.get("remove_screen");
    expect(handle).toBeDefined();
    expect(handle?.enabled).toBe(true);
    handle?.disable();
    expect(handle?.enabled).toBe(false);
  });
});

describe("buildInstructions tiering hint", () => {
  test("includes the reveal_tools guidance only when tiered", () => {
    expect(buildInstructions(false, undefined, false)).not.toContain("reveal_tools");
    const tiered = buildInstructions(false, undefined, true);
    expect(tiered).toContain("reveal_tools");
    expect(tiered).toContain("VELLOO_MCP_PROGRESSIVE");
    // Every family is named so the agent knows what's behind the gate.
    for (const name of Object.keys(TOOL_FAMILIES) as FamilyName[]) {
      expect(tiered).toContain(name);
    }
  });
});
