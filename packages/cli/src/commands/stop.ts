import { resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { type DaemonRecord, daemonRoot, listDaemons, stopDaemon } from "../daemon/runtime.ts";
import { DESIGN_ARG_DESCRIPTION, resolveDesign } from "../design.ts";
import { designWithFolder } from "../design-label.ts";
import { fail } from "../fail.ts";

const ALL = "__all__";

/** A running canvas on one line: design, folder and URL, in one path style for the whole list. */
const canvasLine = (d: DaemonRecord): string =>
  `${designWithFolder(d.root, undefined, { absolute: true })} — ${d.canvasUrl}`;

async function stopEach(daemons: DaemonRecord[]): Promise<void> {
  for (const d of daemons) {
    await stopDaemon(d.root);
    console.log(`velloo: stopped ${canvasLine(d)}`);
  }
}

/** The design this directory resolves to, or undefined where it resolves to none. */
async function designHere(): Promise<string | undefined> {
  try {
    return await resolveDesign(undefined, "stop", {
      onFail: () => {
        throw new Error("no design here");
      },
    });
  } catch {
    return undefined;
  }
}

/** The running canvas for `folder`, when there is one. */
function runningFor(daemons: DaemonRecord[], folder: string | undefined): string | undefined {
  if (!folder) return undefined;
  const root = resolve(daemonRoot(folder));
  return daemons.find((d) => resolve(d.root) === root)?.root;
}

export default defineCommand({
  meta: {
    name: "stop",
    description: "Stop a running canvas (picks from the running ones when none is named)",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    all: {
      type: "boolean",
      default: false,
      description: "Stop every running velloo canvas on this machine",
    },
  },
  async run({ args }) {
    if (args.all) {
      const daemons = await listDaemons();
      if (daemons.length === 0) console.log("velloo: no canvas daemons running.");
      else await stopEach(daemons);
      return;
    }

    // A person at a terminal with nothing named picks from what is running,
    // wherever it was started; scripts keep the directory's own design.
    if (!args.design && process.stdin.isTTY) {
      const daemons = await listDaemons();
      if (daemons.length === 0) {
        console.log("velloo: no canvas daemons running.");
        return;
      }
      if (daemons.length === 1) {
        await stopEach(daemons);
        return;
      }
      const here = runningFor(daemons, await designHere());
      const ordered = [...daemons].sort((a, b) => (a.root === here ? -1 : b.root === here ? 1 : 0));
      const chosen = await select<string>({
        message: "Stop which canvas?",
        options: [
          ...ordered.map((d) => ({
            value: d.root,
            label: designWithFolder(d.root, undefined, { absolute: true }),
            hint: d.root === here ? `${d.canvasUrl} · this directory` : d.canvasUrl,
          })),
          { value: ALL, label: `All ${daemons.length} canvases` },
        ],
        ...(here ? { initialValue: here } : {}),
      });
      if (isCancel(chosen)) fail("stop", "cancelled.");
      await stopEach(chosen === ALL ? daemons : daemons.filter((d) => d.root === chosen));
      return;
    }

    // Nothing named and no design here: rather than an error about velloo.json,
    // say what is running and how to stop it.
    if (!args.design && !(await designHere())) {
      const daemons = await listDaemons();
      if (daemons.length === 0) {
        console.log("velloo: no canvas daemons running.");
        return;
      }
      fail(
        "stop",
        [
          `there is no design in this directory. ${daemons.length} canvas${daemons.length === 1 ? " is" : "es are"} running — stop one by its design folder, or all of them with \`velloo stop --all\`:`,
          ...daemons.map((d) => `  ${canvasLine(d)}`),
        ].join("\n"),
      );
    }

    const folder = await resolveDesign(args.design, "stop");
    const root = daemonRoot(folder);
    if (await stopDaemon(root)) {
      console.log(`velloo: stopped ${designWithFolder(folder)}`);
      return;
    }

    // `stop` is folder-scoped and `status` is machine-wide, so a bare `stop`
    // run from the wrong folder used to report "nothing running" about a
    // daemon `status` was happily listing. Name the others rather than
    // leaving two notions of ownership to reconcile by hand.
    console.log(`velloo: no canvas running for ${designWithFolder(folder)}`);
    const others = await listDaemons();
    if (others.length === 0) return;
    console.log(
      pc.dim(
        `  ${others.length} canvas${others.length === 1 ? "" : "es"} running elsewhere — run \`velloo stop\` to pick, or \`velloo stop --all\`:`,
      ),
    );
    for (const d of others) console.log(pc.dim(`    ${canvasLine(d)}`));
  },
});
