import { open, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentHistoryEntry, AgentItem, AgentTurn } from "@velloo/protocol/agent";
import { checkoutRoot, inCheckout, whereFrom, within } from "../checkout.ts";
import { asRecord } from "../json.ts";
import { toolUseItem, withResult } from "./normalize.ts";

/**
 * Claude Code keeps every session it ran as a JSON-lines transcript under
 * `~/.claude/projects/<cwd with every non-alphanumeric as "-">/<id>.jsonl`, and
 * `claude --resume <id>` finds one only from that same directory. The Desktop
 * app's Code sessions are kept there too, usually from a worktree under
 * `.claude/worktrees/`. So the Agent tab offers every session started anywhere
 * in the app's checkout — the app's directory, the repository root above it, a
 * package beside it, a worktree — and continues each in the directory it ran
 * in. The format is Claude Code's own, not a published contract, so every read
 * here tolerates what it doesn't know.
 */

const LISTED = 30;
/** Bytes read from a transcript to list it; the first prompt is near the start. */
const LIST_BYTES = 256 * 1024;
/** A transcript bigger than this is replayed from its end only. */
const REPLAY_BYTES = 16 * 1024 * 1024;

function projectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

const projectKey = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

export function claudeSessionsDir(cwd: string): string {
  return join(projectsDir(), projectKey(cwd));
}

/** Claude Code's session ids are UUIDs; anything else never names a file. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

interface Transcript {
  path: string;
  id: string;
  size: number;
  at: Date;
  /** The directory key it is filed under, to check against the directory it names. */
  key: string;
}

/**
 * Every transcript filed under a directory of this checkout. The key encoding
 * is lossy (`velloo-biz` shares `velloo`'s prefix), so a candidate is only a
 * candidate until its own `cwd` says where it ran — see `ranIn`.
 */
async function transcriptsFor(cwd: string, id?: string): Promise<Transcript[]> {
  const root = checkoutRoot(cwd);
  const keys = new Set([projectKey(cwd), projectKey(root)]);
  for (let dir = cwd; within(root, dir) && dir !== root; dir = dirname(dir))
    keys.add(projectKey(dir));
  const prefix = `${projectKey(root)}-`;
  const dirs = (await readdir(projectsDir()).catch(() => [] as string[])).filter(
    (name) => keys.has(name) || name.startsWith(prefix),
  );
  const found = await Promise.all(
    dirs.map(async (key) => {
      const dir = join(projectsDir(), key);
      const names = id
        ? [`${id}.jsonl`]
        : (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl"));
      return Promise.all(
        names.map(async (name) => {
          const path = join(dir, name);
          const info = await stat(path).catch(() => null);
          return info?.isFile()
            ? { path, id: name.slice(0, -6), size: info.size, at: info.mtime, key }
            : null;
        }),
      );
    }),
  );
  return found.flat().filter((f): f is Transcript => f !== null);
}

/**
 * Where a session ran, from its own entries: only a directory of this checkout
 * that still exists and is the one it is filed under, since that is where
 * `claude --resume` has to be started to find it.
 */
function ranIn(
  lines: Record<string, unknown>[],
  file: Transcript,
  cwd: string,
): string | undefined {
  const where = lines.map((l) => l.cwd).find((c): c is string => typeof c === "string");
  if (!where || projectKey(where) !== file.key || !inCheckout(cwd, where)) return undefined;
  return where;
}

/** A session this checkout kept: its transcript, and the directory to continue it in. */
export interface ClaudeSessionFile {
  path: string;
  cwd: string;
}

/** The session with this id, if one of this checkout's directories kept it. */
export async function findClaudeSession(
  cwd: string,
  sessionId: string,
): Promise<ClaudeSessionFile | undefined> {
  if (!SESSION_ID.test(sessionId)) return undefined;
  for (const file of await transcriptsFor(cwd, sessionId)) {
    const head = await readPart(file.path, file.size, LIST_BYTES, "start").catch(() => "");
    const where = ranIn(parseLines(head, false), file, cwd);
    if (where) return { path: file.path, cwd: where };
  }
  return undefined;
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * What a person typed, from a user entry, or nothing for the entries Claude
 * Code writes in the person's name: tool results, slash-command echoes,
 * reminders and compaction summaries.
 */
function promptText(entry: Record<string, unknown>): string | undefined {
  if (entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true)
    return undefined;
  const content = asRecord(entry.message).content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content) && content.every((b) => asRecord(b).type === "text")
        ? content.map((b) => str(asRecord(b).text) ?? "").join("\n")
        : undefined;
  const trimmed = text?.trim();
  if (!trimmed || /^<(command-|local-command|system-reminder|bash-)/.test(trimmed))
    return undefined;
  if (trimmed.startsWith("Caveat:")) return undefined;
  return trimmed;
}

function parseLines(text: string, skipFirst: boolean): Record<string, unknown>[] {
  const lines = text.split("\n");
  if (skipFirst) lines.shift();
  return lines.flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [asRecord(JSON.parse(line))];
    } catch {
      return [];
    }
  });
}

async function readPart(
  path: string,
  size: number,
  max: number,
  from: "start" | "end",
): Promise<string> {
  const length = Math.min(size, max);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, from === "end" ? size - length : 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Delete a session the way Claude Code would have to forget it: its transcript,
 * and the folder beside it that holds its subagents' transcripts and large
 * tool results.
 */
export async function deleteClaudeSession({ path }: ClaudeSessionFile): Promise<void> {
  await rm(path, { force: true });
  await rm(path.slice(0, -".jsonl".length), { recursive: true, force: true });
}

/** Sessions Claude Code kept for this checkout, newest first. */
export async function listClaudeSessions(cwd: string): Promise<AgentHistoryEntry[]> {
  const newest = (await transcriptsFor(cwd)).sort((a, b) => b.at.getTime() - a.at.getTime());

  const entries: AgentHistoryEntry[] = [];
  for (const file of newest) {
    if (entries.length >= LISTED) break;
    const head = await readPart(file.path, file.size, LIST_BYTES, "start").catch(() => "");
    const tail =
      file.size > LIST_BYTES
        ? await readPart(file.path, file.size, LIST_BYTES, "end").catch(() => "")
        : "";
    const lines = [...parseLines(head, false), ...parseLines(tail, true)];
    const first = lines.find((l) => l.type === "user" && promptText(l) !== undefined);
    const where = ranIn(lines, file, cwd);
    if (!first || !where) continue;
    const named = lines.findLast((l) => l.type === "custom-title" && str(l.customTitle));
    const summary = lines.findLast((l) => l.type === "summary" && str(l.summary));
    const title =
      str(named?.customTitle) ?? str(summary?.summary) ?? promptText(first)?.split("\n")[0] ?? "";
    entries.push({
      providerSessionId: file.id,
      title: title.slice(0, 120) || "Untitled",
      updatedAt: file.at.toISOString(),
      ...whereFrom(cwd, where),
    });
  }
  return entries;
}

/**
 * A session's conversation as turns, for a session reopened in the tab that
 * Velloo didn't start: each prompt opens a turn, and the assistant's text and
 * tool calls — settled by the results that follow — fill it.
 */
export async function readClaudeTranscript({ path, cwd }: ClaudeSessionFile): Promise<AgentTurn[]> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return [];
  const text = await readPart(path, info.size, REPLAY_BYTES, "end");
  const lines = parseLines(text, info.size > REPLAY_BYTES);

  const turns: AgentTurn[] = [];
  const tools = new Map<string, { turn: AgentTurn; index: number }>();
  let turn: AgentTurn | undefined;
  let n = 0;
  for (const line of lines) {
    const at = str(line.timestamp) ?? info.mtime.toISOString();
    if (line.type === "user") {
      const prompt = promptText(line);
      if (prompt !== undefined) {
        turn = { id: `t-${n++}`, status: "completed", items: [], startedAt: at };
        turn.items.push({ kind: "user", id: `u-${n}`, text: prompt });
        turns.push(turn);
        continue;
      }
      const content = asRecord(line.message).content;
      for (const raw of Array.isArray(content) ? content.map(asRecord) : []) {
        const id = str(raw.tool_use_id);
        const found = id ? tools.get(id) : undefined;
        if (raw.type !== "tool_result" || !found) continue;
        const item = found.turn.items[found.index] as AgentItem;
        found.turn.items[found.index] = withResult(
          item,
          raw.content,
          raw.is_error === true,
          line.toolUseResult,
        );
      }
      continue;
    }
    if (line.type !== "assistant" || !turn || line.isSidechain === true) continue;
    turn.completedAt = at;
    const content = asRecord(line.message).content;
    for (const block of Array.isArray(content) ? content.map(asRecord) : []) {
      if (block.type === "text" && str(block.text)?.trim()) {
        turn.items.push({ kind: "agent-text", id: `b-${n++}`, text: str(block.text) ?? "" });
      } else if (block.type === "tool_use" && str(block.id)) {
        const item = toolUseItem(str(block.id) ?? "", str(block.name) ?? "tool", block.input, cwd);
        tools.set(str(block.id) ?? "", { turn, index: turn.items.length });
        turn.items.push(item);
      }
    }
  }
  // A tool whose result never came was cut off when that session ended.
  for (const { turn, index } of tools.values()) {
    const item = turn.items[index];
    if (item && "status" in item && item.status === "running") {
      turn.items[index] = { ...item, status: "failed" } as AgentItem;
      turn.status = "interrupted";
    }
  }
  return turns;
}
