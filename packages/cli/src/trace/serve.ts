import { loadTape, renderPendingRow, renderReport, renderRow, tapeStats } from "./report.ts";
import { newestTape } from "./tapes.ts";

/**
 * Live (`velloo trace --watch`) report server: a tiny local HTTP server —
 * separate from the canvas — that serves the report page and tails the tape
 * over Server-Sent Events. The recorder appends a JSON line (after its image
 * assets are on disk) per tool call; we poll the file and push each new row's
 * pre-rendered HTML, so the page grows as the agent works. With no pinned
 * `session` it follows the newest tape and reloads when a fresh one appears.
 *
 * Each `call` event carries an SSE `id:` (= records streamed so far). On an
 * auto-reconnect the browser replays it via `Last-Event-ID`, so we resume from
 * that cursor instead of re-streaming the whole tape (which duplicated rows).
 * `idleTimeout: 0` + periodic `: ping` comments keep the stream from being
 * dropped while idle.
 */

export interface ServeOptions {
  /** Trace root (`…/.velloo/trace`) or a single tape dir. */
  root: string;
  hostname: string;
  /** 0 picks an ephemeral port. */
  port: number;
  /** Pin one tape dir (absolute) instead of following the newest. */
  session?: string | undefined;
  pollMs?: number | undefined;
}

export interface LiveServer {
  url: string;
  stop: () => void;
}

function resumeCursor(req: Request, since: number): number {
  const last = req.headers.get("last-event-id");
  if (last && Number.isFinite(Number(last))) return Number(last);
  return since;
}

function sse(
  req: Request,
  startDir: string | null,
  since: number,
  pollMs: number,
  pinned: boolean,
  root: string,
): Response {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let curDir = startDir;
      let sent = resumeCursor(req, since);
      let pendingSig = "";
      const write = (s: string): void => controller.enqueue(enc.encode(s));
      write(": connected\n\n");

      const tick = (): void => {
        try {
          const newest = pinned ? curDir : newestTape(root);
          if (!pinned && newest && newest !== curDir) {
            // A new agent session started a new tape — reload onto it. No id, so
            // it doesn't poison the resume cursor for the reloaded page.
            curDir = newest;
            write("event: reload\ndata: {}\n\n");
            return;
          }
          const tape = curDir ? loadTape(curDir) : null;
          let quiet = true;
          if (tape && tape.records.length > sent) {
            const stats = tapeStats(tape);
            for (let i = sent; i < tape.records.length; i++) {
              const rec = tape.records[i];
              if (!rec) continue;
              const data = JSON.stringify({
                html: renderRow(curDir as string, rec),
                stats,
                seq: rec.seq,
              });
              write(`id: ${i + 1}\nevent: call\ndata: ${data}\n\n`);
            }
            sent = tape.records.length;
            quiet = false;
          }
          // In-flight calls: push the set only when it changes. The client adds
          // a "running" row per pending seq and drops ones that have resolved.
          const pendingCalls = tape?.pending ?? [];
          const sig = pendingCalls.map((p) => p.seq).join(",");
          if (sig !== pendingSig) {
            pendingSig = sig;
            const rows = pendingCalls.map((p) => ({ seq: p.seq, html: renderPendingRow(p) }));
            write(`event: pending\ndata: ${JSON.stringify(rows)}\n\n`);
            quiet = false;
          }
          if (quiet) write(": ping\n\n"); // keep the connection warm between calls
        } catch {
          // transient read race (line mid-write) or a closed controller — retry
        }
      };
      timer = setInterval(tick, pollMs);
      req.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export function serveLiveReport(opts: ServeOptions): LiveServer {
  const pollMs = opts.pollMs ?? 600;
  const pinned = opts.session !== undefined;
  const currentTape = (): string | null => opts.session ?? newestTape(opts.root);

  const server = Bun.serve({
    hostname: opts.hostname,
    port: opts.port,
    idleTimeout: 0, // never time out the long-lived SSE stream
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        const dir = currentTape();
        const tape = dir ? loadTape(dir) : { dir: opts.root, meta: {}, records: [], pending: [] };
        return new Response(renderReport(tape, { live: true }), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url.pathname === "/events") {
        const since = Number(url.searchParams.get("since") ?? "0") || 0;
        return sse(req, currentTape(), since, pollMs, pinned, opts.root);
      }
      return new Response("not found", { status: 404 });
    },
  });

  const host = opts.hostname === "0.0.0.0" ? "127.0.0.1" : opts.hostname;
  return {
    url: `http://${host}:${server.port}/`,
    stop: () => server.stop(true),
  };
}
