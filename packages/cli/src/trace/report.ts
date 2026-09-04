import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";

/**
 * Offline reader + HTML renderer for a recorded MCP session tape (written by
 * the server's `VELLOO_TRACE` recorder). Reads are lenient — a tape is a debug
 * artifact, so a malformed line is skipped rather than aborting the report.
 * Screenshots are inlined as data URIs so a static report opens anywhere, with
 * no server and no canvas. The same row renderer feeds the live `--watch` mode.
 */

const AssetRefSchema = z.object({
  file: z.string(),
  mimeType: z.string(),
  bytes: z.number(),
});
type AssetRef = z.infer<typeof AssetRefSchema>;

/**
 * A tape is written by a *different, still-running* process, one line at a
 * time — so every read here is untrusted input: a half-written final line, a
 * file from an older recorder, a `null` where an object was expected. Fields
 * stay optional (the report renders whatever a call managed to record), but
 * the shape is parsed rather than asserted, because `JSON.parse("null") as
 * TapeRecord` reads fine and then throws on first property access.
 */
const TapeRecordSchema = z.object({
  seq: z.number().optional(),
  ts: z.string().optional(),
  tool: z.string().optional(),
  durationMs: z.number().optional(),
  ok: z.boolean().optional(),
  params: z.unknown().optional(),
  text: z.string().optional(),
  images: z.array(AssetRefSchema).optional(),
  isError: z.boolean().optional(),
  error: z
    .object({
      name: z.string().optional(),
      message: z.string().optional(),
      stack: z.string().optional(),
    })
    .optional(),
  sessionId: z.string().optional(),
});
type TapeRecord = z.infer<typeof TapeRecordSchema>;

const TapeMetaSchema = z.object({
  tapeId: z.string().optional(),
  startedAt: z.string().optional(),
  folder: z.string().optional(),
  pid: z.number().optional(),
});
type TapeMeta = z.infer<typeof TapeMetaSchema>;

/** A call still in flight (from `pending.json`) — never completed/recorded. */
const PendingCallSchema = z.object({
  seq: z.number().optional(),
  ts: z.string().optional(),
  tool: z.string().optional(),
  params: z.unknown().optional(),
  sessionId: z.string().optional(),
});
export type PendingCall = z.infer<typeof PendingCallSchema>;

export interface Tape {
  dir: string;
  meta: TapeMeta;
  records: TapeRecord[];
  /** In-flight calls at read time (a hung call lingers here). */
  pending: PendingCall[];
}

export interface TapeStats {
  calls: number;
  errors: number;
  totalLabel: string;
}

export function loadTape(dir: string): Tape {
  let meta: TapeMeta = {};
  try {
    const parsed = TapeMetaSchema.safeParse(
      JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")),
    );
    if (parsed.success) meta = parsed.data;
  } catch {
    // meta is optional; the jsonl is the source of truth.
  }
  const records: TapeRecord[] = [];
  let raw = "";
  try {
    raw = readFileSync(join(dir, "tape.jsonl"), "utf8");
  } catch {
    // an empty/absent tape renders an empty report rather than crashing.
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = TapeRecordSchema.safeParse(JSON.parse(t));
      if (parsed.success) records.push(parsed.data);
    } catch {
      // skip a half-written final line
    }
  }
  let pending: PendingCall[] = [];
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, "pending.json"), "utf8"));
    if (Array.isArray(raw)) {
      pending = raw.flatMap((entry) => {
        const parsed = PendingCallSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      });
    }
  } catch {
    // no in-flight calls (or no pending.json) — fine.
  }
  // A call can be recorded between reading the tape and pending.json; drop any
  // pending entry that already landed as a completed record.
  const done = new Set(records.map((r) => r.seq));
  pending = pending.filter((p) => !done.has(p.seq));
  return { dir, meta, records, pending };
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

function isBad(r: TapeRecord): boolean {
  return r.ok === false || r.isError === true || Boolean(r.error);
}

/** Pretty-print result text as JSON when it parses, else return it verbatim. */
function prettyJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function fmtDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

function timeOnly(iso: string | undefined): string {
  if (!iso) return "";
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? (m[1] as string) : iso;
}

export function tapeStats(tape: Tape): TapeStats {
  const totalMs = tape.records.reduce((s, r) => s + (r.durationMs ?? 0), 0);
  return {
    calls: tape.records.length,
    errors: tape.records.filter(isBad).length,
    totalLabel: fmtDuration(totalMs),
  };
}

/** A `type/subtype` media type, else a safe default — keeps it out of the src attr as a vector. */
function safeMimeType(mime: string): string {
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) ? mime : "application/octet-stream";
}

function inlineImage(dir: string, asset: AssetRef): string {
  let dataUri = "";
  try {
    // Confine the read to the tape dir — a tape's `file` is untrusted input.
    const abs = resolve(dir, asset.file);
    if (abs !== resolve(dir) && !abs.startsWith(resolve(dir) + sep)) {
      return `<div class="missing">out-of-tree asset: ${esc(asset.file)}</div>`;
    }
    const buf = readFileSync(abs);
    dataUri = `data:${safeMimeType(asset.mimeType)};base64,${buf.toString("base64")}`;
  } catch {
    return `<div class="missing">missing asset: ${esc(asset.file)}</div>`;
  }
  // Clickable, but no navigation — the click opens an in-page lightbox (a huge
  // data: URI can't be opened as a top-level document; it just yields about:blank).
  return `<img class="shot" loading="lazy" src="${dataUri}" alt="${esc(asset.file)}"/>`;
}

function renderResult(dir: string, rec: TapeRecord): string {
  if (rec.error) {
    const head = esc([rec.error.name, rec.error.message].filter(Boolean).join(": ") || "error");
    const stack = rec.error.stack ? `<pre class="stack">${esc(rec.error.stack)}</pre>` : "";
    return `<div class="err-box"><div class="err-head">${head}</div>${stack}</div>`;
  }
  const parts: string[] = [];
  if (rec.text) {
    parts.push(`<pre class="json">${esc(prettyJsonText(rec.text))}</pre>`);
  }
  if (rec.images?.length) {
    const imgs = rec.images
      .map(
        (a) =>
          `<figure>${inlineImage(dir, a)}<figcaption>${esc(a.file.replace(/^assets\//, ""))} · ${fmtBytes(a.bytes)}</figcaption></figure>`,
      )
      .join("");
    parts.push(`<div class="shots">${imgs}</div>`);
  }
  if (rec.isError) {
    parts.unshift(`<div class="flag">isError: true</div>`);
  }
  return parts.join("") || `<div class="muted">no output</div>`;
}

/** One tool call as a collapsible row. Reused for both static and live output. */
export function renderRow(dir: string, rec: TapeRecord): string {
  const bad = isBad(rec);
  const tool = esc(rec.tool ?? "?");
  const seq = rec.seq ?? "";
  const params = esc(JSON.stringify(rec.params ?? null, null, 2));
  const search = esc(
    `${rec.tool ?? ""} ${rec.text ?? ""} ${JSON.stringify(rec.params ?? "")}`
      .toLowerCase()
      .slice(0, 4000),
  );
  const nShots = rec.images?.length ? ` · ${rec.images.length}📷` : "";
  return `<details class="call${bad ? " bad" : ""}" data-seq="${rec.seq ?? ""}" data-error="${bad ? 1 : 0}" data-search="${search}">
  <summary>
    <span class="dot"></span>
    <span class="seq">#${seq}</span>
    <span class="tool">${tool}</span>
    <span class="meta">${fmtDuration(rec.durationMs)}${nShots}</span>
    <span class="ts">${esc(timeOnly(rec.ts))}</span>
  </summary>
  <div class="body">
    <div class="col"><h4>params</h4><pre class="json">${params}</pre></div>
    <div class="col"><h4>result</h4>${renderResult(dir, rec)}</div>
  </div>
</details>`;
}

/** An in-flight call: shown open, with a "running" state and no result yet. */
export function renderPendingRow(p: PendingCall): string {
  const tool = esc(p.tool ?? "?");
  const seq = p.seq ?? "";
  const params = esc(JSON.stringify(p.params ?? null, null, 2));
  const search = esc(
    `${p.tool ?? ""} ${JSON.stringify(p.params ?? "")}`.toLowerCase().slice(0, 4000),
  );
  return `<details class="call pending" data-seq="${seq}" data-pending="1" data-error="0" data-search="${search}" open>
  <summary>
    <span class="dot"></span>
    <span class="seq">#${seq}</span>
    <span class="tool">${tool}</span>
    <span class="meta">running…</span>
    <span class="ts">${esc(timeOnly(p.ts))}</span>
  </summary>
  <div class="body">
    <div class="col"><h4>params</h4><pre class="json">${params}</pre></div>
    <div class="col"><h4>result</h4><div class="muted">awaiting result — this call hasn't returned yet.</div></div>
  </div>
</details>`;
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0c0e; color: #d7dce3;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  code, pre, .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  header { position: sticky; top: 0; z-index: 5; background: #111317; border-bottom: 1px solid #23262d;
    padding: 14px 20px; }
  header h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
  header h1 .badge { color: #8b93a1; font-weight: 400; }
  .live { color: #3fb950; font-size: 11px; font-weight: 600; margin-left: 8px;
    animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
  .stats { display: flex; gap: 18px; flex-wrap: wrap; color: #8b93a1; font-size: 12.5px; }
  .stats b { color: #d7dce3; font-weight: 600; }
  .stats .err { color: #ff6b6b; }
  .bar { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
  .bar input[type=search] { flex: 1; max-width: 360px; background: #0b0c0e; border: 1px solid #2b2f37;
    color: #d7dce3; border-radius: 6px; padding: 6px 10px; font-size: 13px; }
  .bar label { color: #8b93a1; font-size: 12.5px; display: flex; gap: 6px; align-items: center; cursor: pointer; }
  main { padding: 16px 20px 80px; max-width: 1200px; margin: 0 auto; }
  .call { border: 1px solid #23262d; border-radius: 8px; margin-bottom: 8px; background: #111317; overflow: hidden; }
  .call.bad { border-color: #5a2730; }
  summary { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer;
    list-style: none; user-select: none; }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: #15181d; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; flex: none; }
  .call.bad .dot { background: #f85149; }
  .call.pending { border-color: #5a4a1f; }
  .call.pending .dot { background: #ffb86b; animation: pulse 1.2s ease-in-out infinite; }
  .call.pending .meta { color: #ffb86b; }
  .seq { color: #6b7280; font-variant-numeric: tabular-nums; font-size: 12px; min-width: 34px; }
  .tool { font-weight: 600; font-family: ui-monospace, monospace; }
  .meta { color: #8b93a1; font-size: 12px; }
  .ts { margin-left: auto; color: #5b626d; font-size: 12px; font-variant-numeric: tabular-nums; }
  .body { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 4px 14px 16px; }
  @media (max-width: 820px) { .body { grid-template-columns: 1fr; } }
  h4 { margin: 8px 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
  pre.json { margin: 0; padding: 10px 12px; background: #0b0c0e; border: 1px solid #20242b; border-radius: 6px;
    font-size: 12.5px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 460px; }
  .shots { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }
  figure { margin: 0; }
  figure img.shot { max-width: 320px; max-height: 360px; border: 1px solid #2b2f37; border-radius: 6px;
    display: block; cursor: zoom-in; }
  figcaption { color: #6b7280; font-size: 11px; margin-top: 4px; }
  .err-box { background: #1c1011; border: 1px solid #5a2730; border-radius: 6px; padding: 10px 12px; }
  .err-head { color: #ff8b8b; font-weight: 600; font-family: ui-monospace, monospace; font-size: 12.5px; }
  pre.stack { margin: 8px 0 0; font-size: 11.5px; color: #c98b8b; white-space: pre-wrap; overflow-x: auto; }
  .flag { color: #ffb86b; font-size: 12px; margin-bottom: 6px; }
  .muted { color: #5b626d; font-size: 12.5px; }
  .missing { color: #f85149; font-size: 12px; }
  footer { color: #4b515b; font-size: 11.5px; text-align: center; padding: 24px; }
  .lb { position: fixed; inset: 0; background: rgba(0,0,0,.92); display: none; align-items: center;
    justify-content: center; z-index: 100; cursor: zoom-out; padding: 2vmin; }
  .lb.open { display: flex; }
  .lb img { max-width: 96vw; max-height: 96vh; border-radius: 4px; box-shadow: 0 10px 50px rgba(0,0,0,.6); }
`;

function pageScript(live: boolean, initialCount: number): string {
  const base = `
  var q = document.getElementById('q');
  var eo = document.getElementById('errOnly');
  function apply() {
    var needle = q.value.trim().toLowerCase();
    var errsOnly = eo.checked;
    var rows = document.querySelectorAll('.call');
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hit = !needle || (r.getAttribute('data-search') || '').indexOf(needle) !== -1;
      var isErr = r.getAttribute('data-error') === '1';
      r.style.display = (hit && (!errsOnly || isErr)) ? '' : 'none';
    }
  }
  q.addEventListener('input', apply);
  eo.addEventListener('change', apply);

  var lb = document.getElementById('lb'), lbimg = document.getElementById('lbimg');
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('shot')) { lbimg.src = t.src; lb.classList.add('open'); }
    else if (lb.classList.contains('open')) { lb.classList.remove('open'); lbimg.removeAttribute('src'); }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { lb.classList.remove('open'); lbimg.removeAttribute('src'); }
  });`;

  if (!live) return base;

  return `${base}

  function setLive(on) {
    var l = document.getElementById('liveDot');
    if (!l) return;
    if (on) { l.textContent = '● live'; l.style.color = '#3fb950'; l.style.animation = ''; }
    else { l.textContent = '○ disconnected'; l.style.color = '#f85149'; l.style.animation = 'none'; }
  }
  var main = document.querySelector('main');
  // Upsert by call identity (seq): a row replaces any prior row with the same
  // seq, so a completed call overwrites its "running" placeholder and a
  // reconnect re-send can't duplicate.
  function upsert(seq, html) {
    var ph = document.getElementById('placeholder'); if (ph) ph.remove();
    var ex = (seq != null) ? main.querySelector('.call[data-seq="' + seq + '"]') : null;
    if (ex) ex.outerHTML = html; else main.insertAdjacentHTML('beforeend', html);
  }
  var es = new EventSource('/events?since=${initialCount}');
  es.addEventListener('open', function() { setLive(true); });
  es.addEventListener('call', function(ev) {
    var d = JSON.parse(ev.data);
    upsert(d.seq, d.html);
    if (d.stats) {
      document.getElementById('n-calls').textContent = d.stats.calls;
      document.getElementById('n-errors').textContent = d.stats.errors;
      document.getElementById('errstat').className = d.stats.errors ? 'err' : '';
      document.getElementById('n-total').textContent = d.stats.totalLabel;
    }
    apply();
  });
  es.addEventListener('pending', function(ev) {
    var list = JSON.parse(ev.data);
    var want = {};
    for (var i = 0; i < list.length; i++) want[list[i].seq] = 1;
    var cur = main.querySelectorAll('.call[data-pending]');
    for (var j = 0; j < cur.length; j++) {
      if (!want[cur[j].getAttribute('data-seq')]) cur[j].remove();
    }
    for (var k = 0; k < list.length; k++) {
      if (!main.querySelector('.call[data-seq="' + list[k].seq + '"]')) {
        main.insertAdjacentHTML('beforeend', list[k].html);
      }
    }
    apply();
  });
  es.addEventListener('reload', function() { location.reload(); });
  es.onerror = function() { setLive(false); };`;
}

export function renderReport(tape: Tape, opts: { live?: boolean | undefined } = {}): string {
  const { dir, meta, records, pending } = tape;
  const live = opts.live === true;
  const stats = tapeStats(tape);
  const title = `velloo trace · ${meta.tapeId ?? "session"}`;
  const calls = [
    ...records.map((r) => renderRow(dir, r)),
    ...pending.map((p) => renderPendingRow(p)),
  ].join("\n");
  const placeholder = live
    ? '<p class="muted" id="placeholder">Waiting for MCP calls… this view updates live.</p>'
    : '<p class="muted">No calls recorded in this tape.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>velloo trace <span class="badge">${esc(meta.tapeId ?? "")}</span>${live ? '<span class="live" id="liveDot">● live</span>' : ""}</h1>
  <div class="stats">
    <span><b id="n-calls">${stats.calls}</b> calls</span>
    <span id="errstat" class="${stats.errors ? "err" : ""}"><b id="n-errors">${stats.errors}</b> errors</span>
    <span><b id="n-total">${stats.totalLabel}</b> total</span>
    ${meta.startedAt ? `<span>started <b>${esc(meta.startedAt)}</b></span>` : ""}
    ${meta.folder ? `<span class="mono">${esc(meta.folder)}</span>` : ""}
  </div>
  <div class="bar">
    <input id="q" type="search" placeholder="filter by tool, params, or result…"/>
    <label><input id="errOnly" type="checkbox"/> errors only</label>
  </div>
</header>
<main>
${calls || placeholder}
</main>
<footer>Recorded MCP session · ${esc(meta.tapeId ?? "")}</footer>
<div class="lb" id="lb"><img id="lbimg" alt=""/></div>
<script>${pageScript(live, records.length)}</script>
</body>
</html>
`;
}
