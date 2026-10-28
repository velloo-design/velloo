import { dirname, relative, resolve } from "node:path";
import { type AgentProviderInfo, AgentSessionSummarySchema } from "@velloo/protocol/agent";
import {
  InitCheckBodySchema,
  InitCreateBodySchema,
  type InitCreated,
  InitOpenBodySchema,
  type InitState,
} from "@velloo/protocol/init";
import { hostIsLoopback, requestIsLocal, serveCanvasApp } from "@velloo/server";
import type { z } from "zod";
import { type CreatedDesign, createDesign, InitError } from "../commands/init/create.ts";
import { displayPath } from "../commands/init/output.ts";
import { agentOptions } from "../connect/index.ts";
import { type DaemonRecord, ensureDaemon } from "../daemon/runtime.ts";
import { chooseDesignName } from "../manifest.ts";
import { firstPrompt } from "../wizard/handoff.ts";
import { interactiveLibraryChoices } from "../wizard/provider-registry.ts";
import { answersFor, type InitRun, placeFor, repositoryFolderName } from "./answers.ts";
import { goalOptions } from "./goals.ts";
import { type AppReading, describeApp, readApp } from "./read-app.ts";

/** How the page ended: a design was made, or the one already here was opened. */
export type InitOutcome =
  | { kind: "created"; design: CreatedDesign; canvasUrl: string; provider?: string | undefined }
  | { kind: "opened"; folder: string; canvasUrl: string };

export interface InitServerOptions extends InitRun {
  /** The app the design matches, before the person picks another. */
  appRoot: string;
  /** Apps inside the launch root, when it isn't one itself. */
  apps: { dir: string; rel: string }[];
  existing?: { name: string; folder: string } | undefined;
  canvasDist: string;
  host?: string | undefined;
  /** Tried first; any free port otherwise. */
  preferredPort?: number | undefined;
}

export interface InitServer {
  url: string;
  outcome: Promise<InitOutcome>;
  stop(): void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function parse<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid body.");
  return parsed.data as z.infer<S>;
}

/** POST a JSON body to the new design's daemon, as the CLI that started it. */
async function daemonPost(rec: DaemonRecord, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(new URL(path, rec.canvasUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | undefined)?.error?.message;
    throw new HttpError(res.status === 404 ? 409 : res.status, message ?? `${path}: ${res.status}`);
  }
  return payload;
}

/**
 * The setup server `velloo init` runs before the design exists: the canvas
 * bundle's `/init` page, and an API that reads the app and writes the design.
 * It is loopback-only and checks every request the way the daemon does; the
 * page only ever names choices, and every path is resolved here.
 *
 * Once the design is written its own daemon starts, and the page moves there.
 * Starting the agent is done from here, not by the page, so the canvas has no
 * way to be told by a link to run a prompt.
 */
export async function startInitServer(opts: InitServerOptions): Promise<InitServer> {
  const allowedRoots = new Set([opts.appRoot, ...opts.apps.map((a) => a.dir)]);
  const readings = new Map<string, Promise<AppReading>>();
  const reading = (appRoot: string) => {
    let pending = readings.get(appRoot);
    if (!pending) {
      pending = readApp(appRoot, appRoot === opts.appRoot ? opts.scanDir : undefined);
      readings.set(appRoot, pending);
    }
    return pending;
  };
  const appRootOf = (raw: string | null | undefined): string => {
    const appRoot = raw ? resolve(raw) : opts.appRoot;
    if (!allowedRoots.has(appRoot)) throw new HttpError(400, "That isn't one of this repo's apps.");
    return appRoot;
  };

  let creating = false;
  let created: { design: CreatedDesign; rec: DaemonRecord; prompt?: string } | undefined;
  let settle!: (outcome: InitOutcome) => void;
  const outcome = new Promise<InitOutcome>((resolve) => {
    settle = resolve;
  });

  async function state(appRoot: string): Promise<InitState> {
    const read = await reading(appRoot);
    const suggestedName = await chooseDesignName({
      folder: opts.managedFolder,
      appRoot,
      storage: "managed",
      checkout: opts.launchRoot,
    }).catch(() => "design");
    return {
      launchRoot: opts.launchRoot,
      appRoot,
      apps: opts.apps,
      app: describeApp(appRoot, read),
      ...(opts.existing ? { existing: opts.existing } : {}),
      ...(opts.fixed ? { fixed: opts.fixed } : {}),
      libraries: interactiveLibraryChoices().map((c) => ({
        id: c.value,
        label: c.label,
        hint: c.hint,
      })),
      storage: {
        repository: repositoryFolderName(opts),
        external: displayPath(dirname(opts.managedFolder)),
      },
      suggestedName,
      goals: goalOptions(read.found),
      agents: await agentOptions(),
    };
  }

  async function create(req: Request): Promise<InitCreated> {
    if (created || creating) throw new HttpError(409, "The design is already being created.");
    const body = await parse(req, InitCreateBodySchema);
    const appRoot = appRootOf(body.appRoot);
    const { place, problem } = await placeFor({ ...body, appRoot }, opts);
    if (problem) throw new HttpError(400, problem);
    const read = await reading(appRoot);
    const built = answersFor({ ...body, appRoot }, read, place.folder, opts);
    if ("problem" in built) throw new HttpError(400, built.problem);
    const offered = new Set((await agentOptions()).map((a) => a.id));
    // Only global configs are offered, so a local design's wiring writes
    // nothing into the checkout.
    const agents = body.agents.filter((id) => offered.has(id));
    creating = true;
    try {
      const design = await createDesign(built.answers, {
        launchRoot: opts.launchRoot,
        managedId: place.managedId,
        name: body.name?.trim() || undefined,
        pinnedLibrary: Boolean(opts.pinnedLibrary),
        appRead: true,
        wiring: agents.length > 0 ? { agents, manual: false, preWired: [] } : undefined,
      });
      const rec = await ensureDaemon(design.folder);
      const prompt = firstPrompt(built.answers, design.scaffold.screens);
      created = { design, rec, ...(prompt ? { prompt } : {}) };
      return { name: design.name, folder: design.folder, ...(prompt ? { prompt } : {}) };
    } finally {
      creating = false;
    }
  }

  async function providers(): Promise<{ providers: AgentProviderInfo[] }> {
    if (!created) throw new HttpError(409, "Create the design first.");
    const res = await fetch(new URL("/api/agent/providers", created.rec.canvasUrl));
    // A daemon without agents has none to offer; the page then just opens the canvas.
    if (!res.ok) return { providers: [] };
    return (await res.json()) as { providers: AgentProviderInfo[] };
  }

  async function open(req: Request): Promise<{ url: string }> {
    if (!created) throw new HttpError(409, "Create the design first.");
    const { provider } = await parse(req, InitOpenBodySchema);
    const url = new URL(created.rec.canvasUrl);
    if (provider) {
      const started = AgentSessionSummarySchema.pick({ id: true }).safeParse(
        (
          (await daemonPost(created.rec, "/api/agent/sessions", { provider })) as {
            session?: unknown;
          }
        )?.session,
      );
      if (!started.success) throw new HttpError(502, "The agent didn't start.");
      if (created.prompt) {
        await daemonPost(
          created.rec,
          `/api/agent/sessions/${encodeURIComponent(started.data.id)}/turns`,
          { text: created.prompt },
        );
      }
    }
    url.searchParams.set("pane", "agent");
    settle({
      kind: "created",
      design: created.design,
      canvasUrl: created.rec.canvasUrl,
      ...(provider ? { provider } : {}),
    });
    return { url: url.toString() };
  }

  async function openExisting(): Promise<{ url: string }> {
    if (!opts.existing) throw new HttpError(404, "There is no design here yet.");
    const rec = await ensureDaemon(opts.existing.folder);
    settle({ kind: "opened", folder: opts.existing.folder, canvasUrl: rec.canvasUrl });
    return { url: rec.canvasUrl };
  }

  async function api(req: Request, path: string): Promise<Response> {
    if (req.method === "GET" && path === "/api/init/state")
      return json(await state(appRootOf(new URL(req.url).searchParams.get("appRoot"))));
    if (req.method === "POST" && path === "/api/init/check") {
      const body = await parse(req, InitCheckBodySchema);
      const { place, problem } = await placeFor(
        { ...body, appRoot: appRootOf(body.appRoot) },
        opts,
      );
      return json({
        folder: place.managedId
          ? displayPath(place.folder)
          : relative(opts.launchRoot, place.folder) || ".",
        ...(problem ? { problem } : {}),
      });
    }
    if (req.method === "POST" && path === "/api/init/create") return json(await create(req));
    if (req.method === "GET" && path === "/api/init/agents") return json(await providers());
    if (req.method === "POST" && path === "/api/init/open") return json(await open(req));
    if (req.method === "POST" && path === "/api/init/open-existing")
      return json(await openExisting());
    return json({ error: { message: "Not found" } }, 404);
  }

  const fetchHandler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const headers = { host: req.headers.get("host"), origin: req.headers.get("origin") };
    if (url.pathname.startsWith("/api/")) {
      if (!requestIsLocal(headers)) return new Response("Forbidden", { status: 403 });
      try {
        return await api(req, url.pathname);
      } catch (error) {
        if (error instanceof HttpError)
          return json({ error: { message: error.message } }, error.status);
        if (error instanceof InitError) return json({ error: { message: error.message } }, 400);
        console.error(error);
        return json({ error: { message: (error as Error).message } }, 500);
      }
    }
    if (!hostIsLoopback(headers.host)) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/") return Response.redirect(new URL("/init", url).toString(), 302);
    return serveCanvasApp(req, opts.canvasDist);
  };

  const hostname = opts.host ?? "127.0.0.1";
  const serve = (port: number) => Bun.serve({ port, hostname, fetch: fetchHandler });
  let server: ReturnType<typeof serve>;
  try {
    server = serve(opts.preferredPort ?? 0);
  } catch {
    server = serve(0);
  }
  const shownHost = hostname.includes(":") ? `[${hostname}]` : hostname;
  return {
    url: `http://${shownHost}:${server.port}/init`,
    outcome,
    stop: () => server.stop(true),
  };
}
