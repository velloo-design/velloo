import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface CursorRulesResult {
  installed: boolean;
  path?: string;
  reason?: string;
}

/**
 * Cursor's equivalent of the Claude skill: a project rule at
 * `.cursor/rules/velloo.mdc` that tells the agent the velloo MCP exists and
 * how to drive it. Mirrors the skill's intent in Cursor's MDC format; the
 * authoritative tool reference is still the MCP server's `initialize` output.
 */
export async function installCursorRules(
  projectRoot: string,
  designFolder: string,
): Promise<CursorRulesResult> {
  const designRel = relative(projectRoot, designFolder) || ".";
  const body = `---
description: Drive UI design through the Velloo MCP server (a local design canvas backed by this project's shadcn components).
alwaysApply: false
---

# Velloo design

Velloo is a local, code-shaped design canvas exposed over MCP. The design folder
for this project is \`${designRel}\`.

- Cursor starts the velloo MCP server itself (wired as \`velloo mcp\`), so the
  tools are available once the MCP config is loaded — nothing to start first. If
  they're missing, ask the user to run \`velloo connect ${designRel}\` and
  restart Cursor. To watch the canvas, run \`velloo run ${designRel}\`
  (http://127.0.0.1:7300).
- You are the designer: compose screens from the project's shadcn components via
  the velloo MCP tools, verify visually with \`screenshot\`, then \`emit_code\` to
  turn a design into real code in this project's conventions.
- Read the server's \`initialize\` instructions — they are the authoritative tool
  reference; this rule is just the pointer.
- Designs are static on the canvas (no handlers, routing, or data fetching);
  write those when you implement.
`;
  const dest = join(projectRoot, ".cursor", "rules", "velloo.mdc");
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, body, "utf8");
  return { installed: true, path: dest };
}
