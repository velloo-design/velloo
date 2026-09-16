import { writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineCommand } from "citty";
import { DESIGN_ARG_DESCRIPTION, resolveDesign } from "../design.ts";
import { fail } from "../fail.ts";
import { openUrl } from "../open-url.ts";
import { loadTape, renderReport } from "../trace/report.ts";
import { serveLiveReport } from "../trace/serve.ts";
import { findTapes, TRACE_SUBDIR } from "../trace/tapes.ts";

export default defineCommand({
  meta: {
    name: "trace",
    description: "Render a recorded MCP session as a standalone offline HTML report",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    dir: {
      type: "string",
      description: "Trace root or a single tape dir (default: the design folder's .velloo/trace)",
    },
    session: {
      type: "string",
      description: "Tape id to render (default: the most recent)",
    },
    watch: {
      type: "boolean",
      description: "Serve a live report that updates as calls happen (Ctrl-C to stop)",
    },
    port: {
      type: "string",
      description: "Port for --watch (default: an ephemeral one)",
    },
    out: {
      type: "string",
      description: "Output HTML path for the static report (default: <tape>/report.html)",
    },
    list: {
      type: "boolean",
      description: "List recorded sessions and exit",
    },
    open: {
      type: "boolean",
      default: true,
      description: "Open the report in your browser (use --no-open to skip)",
    },
  },
  async run({ args }) {
    // An explicit --dir needs no design folder; otherwise resolve one to locate
    // its .velloo/trace.
    const root = args.dir
      ? resolve(args.dir)
      : join(await resolveDesign(args.design, "trace"), TRACE_SUBDIR);

    if (args.watch) {
      // Live mode: follow the newest tape (or a pinned --session). Unlike the
      // static path this is fine starting before any tape exists — it shows a
      // "waiting" page and switches in the session once the agent connects.
      let session: string | undefined;
      if (args.session) {
        session = findTapes(root).find((t) => basename(t) === args.session);
        if (!session) fail("trace", `session "${args.session}" not found in ${root}.`);
      }
      const server = serveLiveReport({
        root,
        hostname: "127.0.0.1",
        port: args.port ? Number(args.port) : 0,
        session,
      });
      console.log(`velloo trace: live at ${server.url} — Ctrl-C to stop`);
      if (args.open) await openUrl(server.url);
      await new Promise<void>((done) => {
        const stop = (): void => {
          server.stop();
          done();
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
      return;
    }

    const tapes = findTapes(root);
    if (tapes.length === 0) fail("trace", `no recorded sessions found in ${root}.`);

    if (args.list) {
      for (const dir of tapes) {
        const { meta, records } = loadTape(dir);
        console.log(
          `${meta.tapeId ?? basename(dir)}  ${records.length} calls  ${meta.startedAt ?? ""}`.trim(),
        );
      }
      return;
    }

    let tapeDir = tapes[0] as string;
    if (args.session) {
      const match = tapes.find((t) => basename(t) === args.session);
      if (!match) fail("trace", `session "${args.session}" not found in ${root}.`);
      tapeDir = match;
    }

    const tape = loadTape(tapeDir);
    const html = renderReport(tape);
    const out = args.out ? resolve(args.out) : join(tapeDir, "report.html");
    writeFileSync(out, html);
    console.log(`velloo trace: wrote ${out} (${tape.records.length} calls)`);
    console.log(
      "velloo trace: tip — add `--watch` for a live report that updates as the agent works.",
    );
    if (args.open) await openUrl(`file://${out}`);
  },
});
