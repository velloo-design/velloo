import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TOOL_VERSION } from "../version.ts";
import type { AgentTarget, McpConnection } from "./agents.ts";

export interface WriteResult {
  agent: string;
  path: string;
  action: "created" | "updated";
}

/**
 * Idempotently merge velloo's MCP entry into one agent's config, in that
 * agent's format (see AgentConfigFormat). Every merge replaces only velloo's
 * own entry and preserves the user's other servers and settings — so
 * re-running refreshes velloo without clobbering anything else.
 */
export async function writeAgentConfig(
  projectRoot: string,
  agent: AgentTarget,
  conn: McpConnection,
  homeDir: string,
): Promise<WriteResult> {
  const path = agent.path(projectRoot, homeDir);
  const entry = agent.entry(conn);

  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  let content: string;
  switch (agent.format) {
    case "json":
      content = mergeJson(existing, entry, path);
      break;
    case "codex-toml":
      content = mergeCodexToml(existing, entry, path);
      break;
    case "continue-block":
      content = continueBlockFile(entry);
      break;
    case "continue-config":
      content = mergeContinueConfig(existing, entry, path);
      break;
    case "opencode-json":
      content = mergeOpencodeJson(existing, entry, path);
      break;
    case "vscode-json":
      content = mergeVscodeJson(existing, entry, path);
      break;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return { agent: agent.id, path, action: existing === null ? "created" : "updated" };
}

function invalidConfig(path: string, format: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `${path} exists but isn't valid ${format} (${msg}) — fix or remove it, then re-run connect.`,
  );
}

/** JSON `mcpServers.<id>` convention (Claude Code, Cursor): replace only `mcpServers.velloo`. */
function mergeJson(existing: string | null, entry: Record<string, unknown>, path: string): string {
  let parsed: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
    } catch (err) {
      throw invalidConfig(path, "JSON", err);
    }
  }
  const servers =
    parsed.mcpServers && typeof parsed.mcpServers === "object"
      ? (parsed.mcpServers as Record<string, unknown>)
      : {};
  const merged = { ...parsed, mcpServers: { ...servers, velloo: entry } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * opencode's `opencode.json` (opencode.ai/config.json schema): MCP servers
 * live under a top-level `mcp` map. Replace only `mcp.velloo`; a fresh file
 * gets the $schema pointer so editors validate it.
 */
function mergeOpencodeJson(
  existing: string | null,
  entry: Record<string, unknown>,
  path: string,
): string {
  let parsed: Record<string, unknown> = { $schema: "https://opencode.ai/config.json" };
  if (existing !== null) {
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
    } catch (err) {
      throw invalidConfig(path, "JSON", err);
    }
  }
  const mcp =
    parsed.mcp && typeof parsed.mcp === "object" ? (parsed.mcp as Record<string, unknown>) : {};
  const merged = { ...parsed, mcp: { ...mcp, velloo: entry } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** VS Code `.vscode/mcp.json` (Copilot agent mode): a `servers` map, not `mcpServers`. */
function mergeVscodeJson(
  existing: string | null,
  entry: Record<string, unknown>,
  path: string,
): string {
  let parsed: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
    } catch (err) {
      throw invalidConfig(path, "JSON", err);
    }
  }
  const servers =
    parsed.servers && typeof parsed.servers === "object"
      ? (parsed.servers as Record<string, unknown>)
      : {};
  const merged = { ...parsed, servers: { ...servers, velloo: entry } };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

// TOML scalar/array serialization. JSON string escaping is a subset of TOML
// basic-string escaping, so JSON.stringify is a valid TOML string emitter.
function tomlValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  return String(v);
}

/** Matches the `[mcp_servers.velloo]` header and any of its subtables. */
const VELLOO_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*(?:"velloo"|velloo)\s*(?:\]|\.)/;
const ANY_TABLE = /^\s*\[/;

/**
 * Codex `config.toml` (`[mcp_servers.velloo]` — developers.openai.com/codex/mcp).
 * TOML round-tripping through a parser would drop the user's comments, so this
 * splices textually: remove any existing velloo table (and its subtables),
 * insert a fresh block in its place (or append), leave every other line
 * byte-identical. Both the input and the result must parse as TOML.
 */
function mergeCodexToml(
  existing: string | null,
  entry: Record<string, unknown>,
  path: string,
): string {
  if (existing !== null && existing.trim() !== "") {
    try {
      Bun.TOML.parse(existing);
    } catch (err) {
      throw invalidConfig(path, "TOML", err);
    }
  }

  const lines = existing === null ? [] : existing.split("\n");
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") lines.pop();

  const keep: string[] = [];
  let insertAt = -1;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (VELLOO_TABLE.test(line)) {
      if (insertAt === -1) insertAt = keep.length;
      i++;
      while (i < lines.length && !ANY_TABLE.test(lines[i] as string)) i++;
      continue;
    }
    keep.push(line);
    i++;
  }

  const block = [
    "[mcp_servers.velloo]",
    ...Object.entries(entry).map(([k, v]) => `${k} = ${tomlValue(v)}`),
  ];
  if (insertAt === -1) {
    if (keep.length > 0 && keep[keep.length - 1]?.trim() !== "") keep.push("");
    keep.push(...block);
  } else {
    keep.splice(insertAt, 0, ...block);
  }

  const content = `${keep.join("\n")}\n`;
  Bun.TOML.parse(content); // sanity: never write a config Codex can't read
  return content;
}

function toYaml(value: Record<string, unknown>): string {
  // Bun's YAML emitter leaves trailing spaces on block-mapping keys; strip
  // them so the file is tidy under editors that trim on save.
  const yaml = Bun.YAML.stringify(value, null, 2).replace(/[ \t]+$/gm, "");
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

/**
 * Continue workspace block file (`.continue/mcpServers/velloo.yaml` —
 * docs.continue.dev/customize/deep-dives/mcp). The file is velloo's own
 * standalone block, so it's written whole; `name`/`version`/`schema` are the
 * required block metadata.
 */
function continueBlockFile(entry: Record<string, unknown>): string {
  // TOOL_VERSION carries a build stamp in built binaries; the block's
  // `version` metadata wants the bare semver.
  const version = TOOL_VERSION.split(" ")[0] ?? "0.0.0";
  return toYaml({ name: "velloo", version, schema: "v1", mcpServers: [entry] });
}

/**
 * Continue global config (`~/.continue/config.yaml`): replace the `velloo`
 * entry of the `mcpServers` list, preserving every other entry and top-level
 * key. YAML has no comment-preserving parse here, so comments in an existing
 * config.yaml are lost on merge — the data isn't. (Continue's legacy
 * `config.json` is deprecated; velloo writes only the current YAML format.)
 */
function mergeContinueConfig(
  existing: string | null,
  entry: Record<string, unknown>,
  path: string,
): string {
  // Continue requires the assistant metadata header; match its local default.
  let doc: Record<string, unknown> = { name: "Local Assistant", version: "1.0.0", schema: "v1" };
  if (existing !== null && existing.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(existing);
    } catch (err) {
      throw invalidConfig(path, "YAML", err);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw invalidConfig(path, "YAML", new Error("expected a top-level mapping"));
    }
    doc = parsed as Record<string, unknown>;
  }
  const servers = Array.isArray(doc.mcpServers) ? doc.mcpServers : [];
  const others = servers.filter(
    (s) => !(s !== null && typeof s === "object" && (s as { name?: unknown }).name === "velloo"),
  );
  return toYaml({ ...doc, mcpServers: [...others, entry] });
}
