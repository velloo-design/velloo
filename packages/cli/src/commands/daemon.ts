import { existsSync } from "node:fs";
import {
  type CanvasAuth,
  type CanvasPublish,
  createServer,
  type ServerHandle,
} from "@velloo/server";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { createCanvasAuth } from "../daemon/canvas-auth.ts";
import { createCanvasPublish } from "../daemon/canvas-publish.ts";
import {
  type DaemonRecord,
  daemonRoot,
  registryRemove,
  registryUpsert,
  removeLock,
  writeLock,
} from "../daemon/runtime.ts";
import { TOOL_VERSION } from "../version.ts";

/** No canvas tabs and no agents for this long → the daemon exits. */
const IDLE_MS = 5 * 60 * 1000;

function portFree(port: number, host: string): boolean {
  try {
    const s = Bun.serve({ port, hostname: host, fetch: () => new Response("") });
    s.stop(true);
    return true;
  } catch {
    return false;
  }
}

export default defineCommand({
  meta: {
    name: "__daemon",
    hidden: true,
    description:
      "(internal) Run the persistent canvas daemon. Spawned by `velloo run` / `velloo mcp`.",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder (absolute)" },
    port: { type: "string", description: "Preferred canvas port" },
    host: { type: "string", description: "Bind hostname (default 127.0.0.1)" },
  },
  async run({ args }) {
    const root = daemonRoot(args.folder);
    const host = args.host ?? "127.0.0.1";
    const cloudUrl = defaultCloudUrl();
    const cred = await loadCredential(cloudUrl);
    // `token` is the boot-time snapshot; `resolveToken` re-reads ~/.velloo on
    // every cloud call, so signing in mid-session (here or via `velloo login`)
    // takes effect without restarting the daemon — the same liveness the
    // canvas account menu already has.
    const cloud = {
      url: cloudUrl,
      token: cred?.token,
      resolveToken: async () => (await loadCredential(cloudUrl))?.token,
    };

    // Live account state + sign-in/out for the canvas account menu — every call
    // re-reads ~/.velloo, so signing in (here or via `velloo login`/`logout`)
    // shows without restarting the daemon.
    const auth: CanvasAuth = createCanvasAuth(cloudUrl);
    // Publishing from the canvas runs the same core as `velloo publish`, over
    // the pipeline this daemon already has warm.
    const publish: CanvasPublish = createCanvasPublish(cloudUrl);

    // Prefer the requested port (7300 by default), fall back to a free one.
    const preferred = args.port ? Number(args.port) : 7300;
    const canvasPort = portFree(preferred, host) ? preferred : 0;
    let handle: ServerHandle;
    try {
      handle = await createServer({
        folder: root,
        port: canvasPort,
        host,
        mcp: { transport: "http", port: 0 },
        cloud,
        auth,
        publish,
      });
    } catch (err) {
      // Lost the preferred port between probe and bind — take any free port.
      if (canvasPort === 0) throw err;
      handle = await createServer({
        folder: root,
        port: 0,
        host,
        mcp: { transport: "http", port: 0 },
        cloud,
        auth,
        publish,
      });
    }

    const rec: DaemonRecord = {
      root,
      pid: process.pid,
      canvasUrl: handle.url,
      canvasPort: handle.port,
      mcpUrl: handle.mcpUrl ?? "",
      mcpPort: handle.mcpPort ?? 0,
      cloudUrl,
      version: TOOL_VERSION,
      startedAt: new Date().toISOString(),
    };
    await writeLock(rec);
    await registryUpsert(rec);
    console.error(
      `velloo: canvas daemon up at ${handle.url} (mcp ${handle.mcpUrl}), pid ${process.pid}`,
    );

    let stopped = false;
    const shutdown = async () => {
      if (stopped) return;
      stopped = true;
      removeLock(root);
      await registryRemove(root).catch(() => undefined);
      await handle.close();
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // Folder-gone exit: deleting the design folder leaves the
    // watcher's fs.watch handles inert on macOS and the daemon serving stale
    // in-memory state, so poll the root directly. Two consecutive misses
    // before shutting down rides out transient FS states (atomic renames,
    // slow network mounts). The per-folder lockfile died with the folder —
    // removeLock tolerates that — so only the global registry needs cleanup,
    // which shutdown() already does.
    let rootMissing = 0;
    setInterval(() => {
      if (existsSync(root)) {
        rootMissing = 0;
        return;
      }
      rootMissing += 1;
      if (rootMissing >= 2) {
        console.error(`velloo: design folder ${root} is gone — shutting down.`);
        void shutdown();
      }
    }, 10_000);

    // Idle-exit: persist past a session, but don't linger forever. Reset the
    // timer whenever a canvas tab or an agent is connected.
    let idleSince: number | null = Date.now();
    setInterval(() => {
      const { canvas, mcp } = handle.connections();
      if (canvas + mcp > 0) {
        idleSince = null;
        return;
      }
      if (idleSince === null) {
        idleSince = Date.now();
        return;
      }
      if (Date.now() - idleSince >= IDLE_MS) {
        console.error("velloo: canvas idle for 5 min — shutting down.");
        void shutdown();
      }
    }, 30_000);

    await new Promise<void>(() => {});
  },
});
