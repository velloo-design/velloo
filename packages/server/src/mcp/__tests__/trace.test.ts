import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTraceRecorder, TraceRecorder, withCallRecording } from "../trace.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-trace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(async () => {
  delete process.env.VELLOO_TRACE;
  await rm(tmp, { recursive: true, force: true });
});

function readLines(dir: string): Record<string, unknown>[] {
  return readFileSync(join(dir, "tape.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("createTraceRecorder gating", () => {
  test("returns null when VELLOO_TRACE is unset", () => {
    delete process.env.VELLOO_TRACE;
    expect(createTraceRecorder(tmp)).toBeNull();
  });

  test("returns null for falsy flag values", () => {
    for (const v of ["", "0", "false", "FALSE"]) {
      process.env.VELLOO_TRACE = v;
      expect(createTraceRecorder(tmp)).toBeNull();
    }
  });

  test("creates a tape dir with meta.json when enabled", () => {
    process.env.VELLOO_TRACE = "1";
    const rec = createTraceRecorder(tmp);
    expect(rec).not.toBeNull();
    const traceRoot = join(tmp, ".velloo", "trace");
    const tapes = readdirSync(traceRoot);
    expect(tapes.length).toBe(1);
    const meta = JSON.parse(readFileSync(join(traceRoot, tapes[0] as string, "meta.json"), "utf8"));
    expect(meta.folder).toBe(tmp);
    expect(typeof meta.tapeId).toBe("string");
    expect(typeof meta.startedAt).toBe("string");
  });
});

describe("TraceRecorder.record", () => {
  test("splits a result into text plus an extracted image asset", () => {
    const rec = new TraceRecorder(tmp);
    rec.record({
      tool: "screenshot",
      params: { screenId: "home", mode: "light" },
      durationMs: 42,
      result: {
        content: [
          { type: "text", text: '{"contentHeight":900}' },
          { type: "image", data: PNG_BASE64, mimeType: "image/png" },
        ],
      },
    });

    const [line] = readLines(tmp);
    expect(line?.tool).toBe("screenshot");
    expect(line?.ok).toBe(true);
    expect(line?.text).toBe('{"contentHeight":900}');
    const images = line?.images as { file: string; mimeType: string; bytes: number }[];
    expect(images).toHaveLength(1);
    expect(images[0]?.file).toBe("assets/0-0.png");
    expect(images[0]?.mimeType).toBe("image/png");
    const asset = readFileSync(join(tmp, "assets/0-0.png"));
    expect(asset.byteLength).toBe(Buffer.from(PNG_BASE64, "base64").byteLength);
  });

  test("records a thrown error with ok:false", () => {
    const rec = new TraceRecorder(tmp);
    rec.record({ tool: "add_node", params: {}, durationMs: 3, error: new Error("boom") });
    const [line] = readLines(tmp);
    expect(line?.ok).toBe(false);
    expect(line?.error).toMatchObject({ message: "boom" });
  });

  test("flags an isError result envelope", () => {
    const rec = new TraceRecorder(tmp);
    rec.record({
      tool: "audit",
      params: {},
      durationMs: 1,
      result: { isError: true, content: [{ type: "text", text: '{"code":"not_found"}' }] },
    });
    const [line] = readLines(tmp);
    expect(line?.ok).toBe(false);
    expect(line?.isError).toBe(true);
    expect(line?.text).toBe('{"code":"not_found"}');
  });

  test("clips overlong param strings", () => {
    const rec = new TraceRecorder(tmp);
    rec.record({
      tool: "upload_asset",
      params: { data: "x".repeat(20_000) },
      durationMs: 5,
      result: { content: [] },
    });
    const [line] = readLines(tmp);
    const data = (line?.params as { data: string } | undefined)?.data ?? "";
    expect(data.length).toBeLessThan(20_000);
    expect(data).toContain("elided");
  });

  test("assigns monotonic seq numbers", () => {
    const rec = new TraceRecorder(tmp);
    rec.record({ tool: "a", params: {}, durationMs: 1, result: { content: [] } });
    rec.record({ tool: "b", params: {}, durationMs: 1, result: { content: [] } });
    const lines = readLines(tmp);
    expect(lines.map((l) => l.seq)).toEqual([0, 1]);
  });
});

describe("withCallRecording", () => {
  test("tapes a handler's tool call through the patched registerTool", async () => {
    const rec = new TraceRecorder(tmp);
    let registered: ((args: unknown, extra: unknown) => unknown) | undefined;
    const fake = {
      registerTool: (_name: string, _config: unknown, cb: (a: unknown, e: unknown) => unknown) => {
        registered = cb;
        return {};
      },
    } as unknown as McpServer;

    withCallRecording(fake, rec);
    fake.registerTool("get_screen", { inputSchema: {} }, (async () => ({
      content: [{ type: "text", text: "ok" }],
    })) as never);
    expect(registered).toBeDefined();
    await registered?.({ screenId: "home" }, { sessionId: "sess-1" });

    const [line] = readLines(tmp);
    expect(line?.tool).toBe("get_screen");
    expect(line?.sessionId).toBe("sess-1");
    expect(line?.text).toBe("ok");
    expect(line?.params).toMatchObject({ screenId: "home" });
  });

  test("tapes and re-throws when the handler rejects", async () => {
    const rec = new TraceRecorder(tmp);
    let registered: ((args: unknown, extra: unknown) => unknown) | undefined;
    const fake = {
      registerTool: (_n: string, _c: unknown, cb: (a: unknown, e: unknown) => unknown) => {
        registered = cb;
        return {};
      },
    } as unknown as McpServer;

    withCallRecording(fake, rec);
    fake.registerTool("boomtool", { inputSchema: {} }, (async () => {
      throw new Error("kaboom");
    }) as never);
    await expect(registered?.({}, {})).rejects.toThrow("kaboom");
    const [line] = readLines(tmp);
    expect(line?.ok).toBe(false);
    expect(line?.error).toMatchObject({ message: "kaboom" });
  });
});

describe("in-flight (pending) tracking", () => {
  function readPending(dir: string): Record<string, unknown>[] {
    return JSON.parse(readFileSync(join(dir, "pending.json"), "utf8")) as Record<string, unknown>[];
  }

  test("start marks the call pending; end clears it and appends the record", () => {
    const rec = new TraceRecorder(tmp);
    const seq = rec.start({ tool: "compare_to_url", params: { url: "http://x" }, sessionId: "s1" });
    expect(seq).toBe(0);
    const pending = readPending(tmp);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.tool).toBe("compare_to_url");
    expect(pending[0]?.seq).toBe(0);
    // Not in the tape until it completes.
    expect(existsSync(join(tmp, "tape.jsonl"))).toBe(false);

    rec.end(seq, { result: { content: [{ type: "text", text: "ok" }] } });
    expect(readPending(tmp)).toHaveLength(0);
    const [line] = readLines(tmp);
    expect(line?.tool).toBe("compare_to_url");
    expect(line?.seq).toBe(0);
    expect(line?.ok).toBe(true);
    expect(line?.text).toBe("ok");
  });

  test("a hung call (start with no end) lingers in pending.json and not the tape", () => {
    const rec = new TraceRecorder(tmp);
    rec.start({ tool: "compare_to_url", params: {} });
    expect(readPending(tmp)).toHaveLength(1);
    expect(existsSync(join(tmp, "tape.jsonl"))).toBe(false);
  });

  test("end records a thrown error and clears the pending marker", () => {
    const rec = new TraceRecorder(tmp);
    const seq = rec.start({ tool: "audit", params: {} });
    rec.end(seq, { error: new Error("stalled") });
    expect(readPending(tmp)).toHaveLength(0);
    const [line] = readLines(tmp);
    expect(line?.ok).toBe(false);
    expect(line?.error).toMatchObject({ message: "stalled" });
  });
});
