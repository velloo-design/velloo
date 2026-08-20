import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Off-by-default agent↔Velloo call recorder. Gated behind the `VELLOO_TRACE`
 * env var — the same flag that reveals the `velloo trace` command — so the
 * whole surface stays hidden in normal use. Set it in the daemon's environment
 * to record a session, then replay it offline with `velloo trace`.
 *
 * One tape per MCP session (one `buildMcpServer`): a directory holding
 * `meta.json`, append-only `tape.jsonl` (one CallRecord per line), and an
 * `assets/` dir of screenshots lifted out of the result envelopes.
 */
const TRACE_ENV = "VELLOO_TRACE";

/** Individual param/result strings longer than this are clipped in the tape. */
const MAX_PARAM_STR = 16_384;

/** A screenshot lifted out of a result envelope into a file beside the tape. */
export interface AssetRef {
  /** Path relative to the tape dir, e.g. `assets/3-0.png`. */
  file: string;
  mimeType: string;
  bytes: number;
}

/** One tool call. Field names are the on-disk contract the visualizer reads. */
export interface CallRecord {
  seq: number;
  ts: string;
  tool: string;
  durationMs: number;
  /** false when the handler threw or the result carried `isError`. */
  ok: boolean;
  params: unknown;
  /** Concatenated text content of the result (the JSON a tool returns). */
  text?: string;
  images?: AssetRef[];
  /** The result envelope's own `isError` flag, distinct from a thrown error. */
  isError?: boolean;
  /** Present only when the handler threw. */
  error?: { name?: string; message: string; stack?: string };
  sessionId?: string;
}

export interface TapeMeta {
  tapeId: string;
  startedAt: string;
  folder: string;
  pid: number;
}

function traceEnabled(): boolean {
  const v = process.env[TRACE_ENV];
  return v !== undefined && v !== "" && v !== "0" && v.toLowerCase() !== "false";
}

function serializeError(err: unknown): { name?: string; message: string; stack?: string } {
  if (err instanceof Error) {
    const out: { name?: string; message: string; stack?: string } = { message: err.message };
    if (err.name) out.name = err.name;
    if (err.stack) out.stack = err.stack;
    return out;
  }
  return { message: String(err) };
}

/** Clip overlong strings (e.g. an `upload_asset` base64 blob) so tapes stay sane. */
function clampStrings(value: unknown, max: number): unknown {
  if (typeof value === "string") {
    return value.length > max
      ? `${value.slice(0, max)}…<elided ${value.length - max} chars>`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => clampStrings(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = clampStrings(v, max);
    }
    return out;
  }
  return value;
}

function extForMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

export interface RecordInput {
  tool: string;
  params: unknown;
  durationMs: number;
  sessionId?: string;
  /** The handler's return value (an MCP result envelope) when it resolved. */
  result?: unknown;
  /** The thrown value when the handler rejected. */
  error?: unknown;
}

/** A tool call in flight. Written to `pending.json` so a hung call is visible. */
export interface PendingCall {
  seq: number;
  ts: string;
  tool: string;
  params: unknown;
  sessionId?: string;
}

export class TraceRecorder {
  private seq = 0;
  private broken = false;
  private startedAt = new Map<number, number>();
  private readonly pending = new Map<number, PendingCall>();
  private readonly assetsDir: string;

  constructor(private readonly dir: string) {
    this.assetsDir = join(dir, "assets");
  }

  /**
   * Claim a seq and mark the call in flight (so a hung call shows up rather than
   * just being absent). Pair every `start` with an `end`. Returns -1 when the
   * recorder is disabled, which `end` treats as a no-op.
   */
  start(input: { tool: string; params: unknown; sessionId?: string }): number {
    if (this.broken) return -1;
    const seq = this.seq++;
    const call: PendingCall = {
      seq,
      ts: new Date().toISOString(),
      tool: input.tool,
      params: clampStrings(input.params, MAX_PARAM_STR),
    };
    if (input.sessionId) call.sessionId = input.sessionId;
    this.pending.set(seq, call);
    this.startedAt.set(seq, Date.now());
    this.writePending();
    return seq;
  }

  /** Resolve an in-flight call: drop the pending marker, append the record. */
  end(seq: number, outcome: { result?: unknown; error?: unknown }): void {
    if (this.broken || seq < 0) return;
    const call = this.pending.get(seq);
    const startedAt = this.startedAt.get(seq);
    this.pending.delete(seq);
    this.startedAt.delete(seq);
    this.write(seq, {
      tool: call?.tool ?? "?",
      params: call?.params ?? null,
      durationMs: startedAt !== undefined ? Date.now() - startedAt : 0,
      ...(call?.sessionId ? { sessionId: call.sessionId } : {}),
      result: outcome.result,
      error: outcome.error,
    });
    this.writePending();
  }

  /** Append a complete record in one shot (no in-flight phase). */
  record(input: RecordInput): void {
    if (this.broken) return;
    this.write(this.seq++, input);
  }

  private write(seq: number, input: RecordInput): void {
    if (this.broken) return;
    try {
      const rec = this.build(seq, input);
      appendFileSync(join(this.dir, "tape.jsonl"), `${JSON.stringify(rec)}\n`);
    } catch (err) {
      // A debug aid must never break the tool path: disable on first failure.
      this.broken = true;
      console.error(`velloo trace: recording disabled after write failure: ${String(err)}`);
    }
  }

  private writePending(): void {
    if (this.broken) return;
    try {
      writeFileSync(join(this.dir, "pending.json"), JSON.stringify([...this.pending.values()]));
    } catch {
      // pending.json is best-effort; never disable recording over it.
    }
  }

  private build(seq: number, input: RecordInput): CallRecord {
    const rec: CallRecord = {
      seq,
      ts: new Date().toISOString(),
      tool: input.tool,
      durationMs: Math.round(input.durationMs),
      ok: true,
      params: clampStrings(input.params, MAX_PARAM_STR),
    };
    if (input.sessionId) rec.sessionId = input.sessionId;
    if (input.error !== undefined) {
      rec.ok = false;
      rec.error = serializeError(input.error);
      return rec;
    }
    const { text, images, isError } = this.splitResult(seq, input.result);
    if (text !== undefined) rec.text = text;
    if (images.length) rec.images = images;
    if (isError) {
      rec.isError = true;
      rec.ok = false;
    }
    return rec;
  }

  private splitResult(
    seq: number,
    result: unknown,
  ): { text?: string; images: AssetRef[]; isError: boolean } {
    const images: AssetRef[] = [];
    const texts: string[] = [];
    const envelope = result as { content?: unknown; isError?: unknown } | null | undefined;
    const isError = envelope?.isError === true;
    const content = envelope?.content;
    if (Array.isArray(content)) {
      let imgIdx = 0;
      for (const item of content) {
        if (!item || typeof item !== "object") continue;
        const type = (item as { type?: unknown }).type;
        if (type === "text") {
          const t = (item as { text?: unknown }).text;
          if (typeof t === "string") texts.push(t);
        } else if (type === "image") {
          const ref = this.writeImage(
            seq,
            imgIdx++,
            item as { data?: unknown; mimeType?: unknown },
          );
          if (ref) images.push(ref);
        }
      }
    }
    return { text: texts.length ? texts.join("\n") : undefined, images, isError };
  }

  private writeImage(
    seq: number,
    idx: number,
    item: { data?: unknown; mimeType?: unknown },
  ): AssetRef | null {
    if (typeof item.data !== "string") return null;
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
    const buf = Buffer.from(item.data, "base64");
    const file = `assets/${seq}-${idx}.${extForMime(mimeType)}`;
    mkdirSync(this.assetsDir, { recursive: true });
    writeFileSync(join(this.dir, file), buf);
    return { file, mimeType, bytes: buf.byteLength };
  }
}

function newTapeId(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${randomUUID().slice(0, 4)}`;
}

/**
 * Build a recorder rooted at `<folderRoot>/.velloo/trace/<tapeId>/`, or `null`
 * when the `VELLOO_TRACE` flag is unset. Diagnostics go to stderr only — stdout
 * carries the stdio-transport JSON-RPC stream and must stay pristine.
 */
export function createTraceRecorder(folderRoot: string): TraceRecorder | null {
  if (!traceEnabled()) return null;
  const tapeId = newTapeId();
  const dir = join(folderRoot, ".velloo", "trace", tapeId);
  try {
    mkdirSync(dir, { recursive: true });
    const meta: TapeMeta = {
      tapeId,
      startedAt: new Date().toISOString(),
      folder: folderRoot,
      pid: process.pid,
    };
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    console.error(`velloo trace: recording MCP session to ${dir}`);
    return new TraceRecorder(dir);
  } catch (err) {
    console.error(`velloo trace: could not start recorder: ${String(err)}`);
    return null;
  }
}

/**
 * Patch `registerTool` so every handler is timed and taped, mirroring how
 * `withStrictToolArgs` rewraps the input schema. Returns the same (mutated)
 * instance for chaining.
 */
export function withCallRecording(mcp: McpServer, recorder: TraceRecorder): McpServer {
  const original = mcp.registerTool.bind(mcp);
  const patched: typeof original = (name, config, cb) => {
    const handler = cb as (args: unknown, extra: unknown) => unknown;
    const wrapped = async (args: unknown, extra: unknown): Promise<unknown> => {
      const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId;
      // Mark in-flight first, so a handler that hangs (e.g. a stalled
      // compare_to_url) shows as a "running" row instead of vanishing.
      const seq = recorder.start({ tool: name, params: args, sessionId });
      try {
        const result = await handler(args, extra);
        recorder.end(seq, { result });
        return result;
      } catch (err) {
        recorder.end(seq, { error: err });
        throw err;
      }
    };
    return original(name, config, wrapped as typeof cb);
  };
  (mcp as { registerTool: typeof original }).registerTool = patched;
  return mcp;
}
