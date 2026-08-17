import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTarget } from "./agents.ts";

export interface WriteResult {
  agent: string;
  path: string;
  action: "created" | "updated";
}

/**
 * Idempotently merge velloo's MCP entry into one agent's config. Reads any
 * existing file, replaces only `mcpServers.velloo`, and preserves every
 * other server and every other top-level key — so re-running refreshes
 * velloo's entry without clobbering a user's other MCP servers or settings.
 */
export async function writeAgentConfig(
  projectRoot: string,
  agent: AgentTarget,
  mcpUrl: string,
): Promise<WriteResult> {
  const path = join(projectRoot, agent.relPath);

  let existing: Record<string, unknown> = {};
  let action: "created" | "updated" = "created";
  try {
    existing = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    action = "updated";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const servers =
    existing.mcpServers && typeof existing.mcpServers === "object"
      ? (existing.mcpServers as Record<string, unknown>)
      : {};

  const merged = {
    ...existing,
    mcpServers: { ...servers, velloo: agent.entry(mcpUrl) },
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return { agent: agent.id, path, action };
}
