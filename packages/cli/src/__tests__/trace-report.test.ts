import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTape, renderReport } from "../trace/report.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `velloo-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmp, "assets"), { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function writeTape(records: unknown[]): void {
  writeFileSync(
    join(tmp, "meta.json"),
    JSON.stringify({
      tapeId: "20260618-120000-abcd",
      startedAt: "2026-06-18T12:00:00.000Z",
      folder: "/x",
    }),
  );
  writeFileSync(join(tmp, "tape.jsonl"), `${records.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

test("loadTape reads meta and skips a malformed line", () => {
  writeFileSync(join(tmp, "meta.json"), JSON.stringify({ tapeId: "t1" }));
  writeFileSync(
    join(tmp, "tape.jsonl"),
    '{"tool":"a","seq":0}\n{ not json\n{"tool":"b","seq":1}\n',
  );
  const tape = loadTape(tmp);
  expect(tape.meta.tapeId).toBe("t1");
  expect(tape.records.map((r) => r.tool)).toEqual(["a", "b"]);
});

test("renderReport embeds tool names, pretty result JSON, and an inlined screenshot", () => {
  writeFileSync(join(tmp, "assets", "0-0.png"), Buffer.from(PNG_BASE64, "base64"));
  writeTape([
    {
      seq: 0,
      ts: "2026-06-18T12:00:01.000Z",
      tool: "screenshot",
      durationMs: 1200,
      ok: true,
      params: { screenId: "home" },
      text: '{"contentHeight":900}',
      images: [{ file: "assets/0-0.png", mimeType: "image/png", bytes: 70 }],
    },
  ]);
  const html = renderReport(loadTape(tmp));
  expect(html).toContain("screenshot");
  expect(html).toContain("20260618-120000-abcd");
  // pretty-printed (indented) result JSON
  expect(html).toContain("contentHeight");
  // params JSON is HTML-escaped, so quotes render as entities
  expect(html).toContain("&quot;screenId&quot;");
  expect(html).toContain("home");
  // screenshot inlined as a data URI (offline, self-contained)
  expect(html).toContain("data:image/png;base64,");
  // duration rendered in seconds
  expect(html).toContain("1.20s");
});

test("renderReport renders a thrown error and marks the call bad", () => {
  writeTape([
    {
      seq: 0,
      tool: "add_node",
      durationMs: 3,
      ok: false,
      params: {},
      error: {
        name: "Error",
        message: "parentPath not found",
        stack: "Error: parentPath not found\n  at x",
      },
    },
  ]);
  const html = renderReport(loadTape(tmp));
  expect(html).toContain("parentPath not found");
  expect(html).toContain('data-error="1"');
  expect(html).toContain('class="call bad"');
});

test("renderReport escapes HTML in recorded content", () => {
  writeTape([
    { seq: 0, tool: "x", durationMs: 1, ok: true, params: { html: "<script>alert(1)</script>" } },
  ]);
  const html = renderReport(loadTape(tmp));
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});

test("renderReport handles an empty tape without crashing", () => {
  writeFileSync(join(tmp, "tape.jsonl"), "");
  const html = renderReport(loadTape(tmp));
  expect(html).toContain("No calls recorded");
});

test("renderReport shows an in-flight call from pending.json", () => {
  writeTape([{ seq: 0, tool: "get_screen", durationMs: 1, ok: true, params: {} }]);
  writeFileSync(
    join(tmp, "pending.json"),
    JSON.stringify([
      { seq: 1, tool: "compare_to_url", ts: "2026-06-20T12:00:05Z", params: { url: "/r" } },
    ]),
  );
  const tape = loadTape(tmp);
  expect(tape.pending).toHaveLength(1);
  const html = renderReport(tape);
  expect(html).toContain('data-pending="1"');
  expect(html).toContain("running…");
  expect(html).toContain("compare_to_url");
});

test("loadTape drops a pending entry that already landed in the tape", () => {
  writeTape([{ seq: 0, tool: "audit", durationMs: 1, ok: true, params: {} }]);
  writeFileSync(join(tmp, "pending.json"), JSON.stringify([{ seq: 0, tool: "audit" }]));
  expect(loadTape(tmp).pending).toHaveLength(0);
});
