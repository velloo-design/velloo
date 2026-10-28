import { dirname, relative, resolve } from "node:path";
import {
  type AgentProviderInfo,
  type AgentSessionControls,
  AgentSessionSummarySchema,
} from "@velloo/protocol/agent";
import {
  type InitCapture,
  InitCheckBodySchema,
  InitCreateBodySchema,
  type InitCreated,
  type InitModels,
  InitModelsBodySchema,
  InitOpenBodySchema,
  type InitPlace,
  type InitState,
} from "@velloo/protocol/init";
import {
  type CaptureSessionHandle,
  HeadedBrowserMissingError,
  sessionStatePath,
  startCaptureSession,
} from "@velloo/renderer";
import { hostIsLoopback, loadDesignFolder, requestIsLocal, serveCanvasApp } from "@velloo/server";
import type { z } from "zod";
import { type CreatedDesign, createDesign, InitError } from "../commands/init/create.ts";
import { displayPath } from "../commands/init/output.ts";
import { agentOptions } from "../connect/index.ts";
import { type DaemonRecord, ensureDaemon } from "../daemon/runtime.ts";
import { chooseDesignName, isWithin } from "../manifest.ts";
import { hasAppToMatch, type WizardAnswers } from "../wizard/answers.ts";
import { firstPrompt } from "../wizard/handoff.ts";
import { interactiveLibraryChoices } from "../wizard/provider-registry.ts";
import { answersFor, type InitRun, type Place, placeFor, repositoryFolderName } from "./answers.ts";
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

/** Call the new design's daemon, as the CLI that started it. */
async function daemonRequest(
  rec: DaemonRecord,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(new URL(path, rec.canvasUrl), {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const message = (payload as { error?: { message?: string } } | undefined)?.error?.message;
    throw new HttpError(res.status === 404 ? 409 : res.status, message ?? `${path}: ${res.status}`);
  }
  return payload;
}

/** Stop a session started only to read its models, and forget it. */
async function dropSession(rec: DaemonRecord, sessionId: string): Promise<void> {
  const session = `/api/agent/sessions/${encodeURIComponent(sessionId)}`;
  await daemonRequest(rec, "POST", `${session}/stop`).catch(() => undefined);
  await daemonRequest(rec, "DELETE", session).catch(() => undefined);
}

/** How long an agent gets to say which models it offers. */
const CONTROLS_TIMEOUT_MS = 20_000;

/**
 * The setup server `velloo init` runs before the design exists: the canvas
 * bundle's `/init` page, and an API that reads the app and writes the design.
 * It is loopback-only and checks every request the way the daemon does; the
 * page names choices, and every path is resolved here.
 *
 * Once the design is written its own daemon starts, and the page moves there.
 * The agent is started from here, on the first task the page shows and the
 * person may edit — the canvas itself only ever opens on the Agent tab, so no
 * link can make it run a prompt.
 */
export async function startInitServer(opts: InitServerOptions): Promise<InitServer> {
  const allowedRoots = new Set([opts.appRoot, ...opts.apps.map((a) => a.dir)]);
  // A repo whose root holds several apps can still be designed as a whole.
  if (opts.apps.length > 0) allowedRoots.add(opts.launchRoot);
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

  const isLocal = (place: Place) =>
    Boolean(place.managedId) || !isWithin(opts.launchRoot, place.folder);

  let creating = false;
  let created:
    | { design: CreatedDesign; answers: WizardAnswers; rec: DaemonRecord; prompt?: string }
    | undefined;
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
      agents: await agentOptions(opts.launchRoot),
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
    // A local design writes nothing into the checkout, so it takes no
    // project configs — only the global ones.
    const local = isLocal(place);
    const offered = new Set(
      (await agentOptions(opts.launchRoot)).flatMap((a) => [
        ...(a.global ? [a.global.id] : []),
        ...(a.project && !local ? [a.project.id] : []),
      ]),
    );
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
      created = { design, answers: built.answers, rec, ...(prompt ? { prompt } : {}) };
      return {
        name: design.name,
        folder: design.folder,
        setup: hasAppToMatch(built.answers),
        ...(prompt ? { prompt } : {}),
      };
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

  /** A session started to read an agent's models, kept for the open that follows. */
  let prepared: { provider: string; sessionId: string } | undefined;

  async function startSession(rec: DaemonRecord, provider: string): Promise<string> {
    const started = AgentSessionSummarySchema.pick({ id: true }).safeParse(
      (
        (await daemonRequest(rec, "POST", "/api/agent/sessions", { provider })) as {
          session?: unknown;
        }
      )?.session,
    );
    if (!started.success) throw new HttpError(502, "The agent didn't start.");
    return started.data.id;
  }

  /** The session's controls, once the agent process has said what it offers. */
  async function controlsOf(
    rec: DaemonRecord,
    sessionId: string,
  ): Promise<AgentSessionControls | undefined> {
    const deadline = Date.now() + CONTROLS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const snapshot = (await daemonRequest(
        rec,
        "GET",
        `/api/agent/sessions/${encodeURIComponent(sessionId)}`,
      )) as { controls?: AgentSessionControls };
      if (snapshot.controls) return snapshot.controls;
      await Bun.sleep(250);
    }
    return undefined;
  }

  async function models(req: Request): Promise<InitModels> {
    if (!created) throw new HttpError(409, "Create the design first.");
    const { provider } = await parse(req, InitModelsBodySchema);
    let session = prepared;
    if (session?.provider !== provider) {
      if (session) await dropSession(created.rec, session.sessionId);
      session = { provider, sessionId: await startSession(created.rec, provider) };
      prepared = session;
    }
    const controls = await controlsOf(created.rec, session.sessionId);
    return {
      models: controls?.models ?? [],
      ...(controls?.model ? { model: controls.model } : {}),
    };
  }

  async function open(req: Request): Promise<{ url: string }> {
    if (!created) throw new HttpError(409, "Create the design first.");
    const { rec } = created;
    const body = await parse(req, InitOpenBodySchema);
    const provider = body.provider;
    const prompt = (body.prompt ?? created.prompt)?.trim();
    const url = new URL(rec.canvasUrl);
    if (provider) {
      const sessionId =
        prepared?.provider === provider ? prepared.sessionId : await startSession(rec, provider);
      if (prepared && prepared.provider !== provider) await dropSession(rec, prepared.sessionId);
      prepared = undefined;
      const session = `/api/agent/sessions/${encodeURIComponent(sessionId)}`;
      if (body.model) {
        const controls = await controlsOf(rec, sessionId);
        if (controls?.model !== body.model)
          await daemonRequest(rec, "POST", `${session}/model`, { model: body.model });
      }
      if (prompt) await daemonRequest(rec, "POST", `${session}/turns`, { text: prompt });
    } else if (prepared) {
      await dropSession(rec, prepared.sessionId);
      prepared = undefined;
    }
    if (capture && !capture.done) await capture.handle.close().catch(() => undefined);
    url.searchParams.set("pane", "agent");
    settle({
      kind: "created",
      design: created.design,
      canvasUrl: rec.canvasUrl,
      ...(provider ? { provider } : {}),
    });
    return { url: url.toString() };
  }

  /**
   * The capture window for a `capture-site` start. It belongs to this process,
   * so it is closed before the page moves to the canvas — what was captured is
   * already in the design folder by then.
   */
  let capture: { handle: CaptureSessionHandle; done: boolean } | undefined;
  let captureProblem: string | undefined;

  function captureState(): InitCapture {
    if (!capture) {
      return {
        state: captureProblem ? "unavailable" : "done",
        captured: [],
        ...(captureProblem ? { problem: captureProblem } : {}),
      };
    }
    const { handle, done } = capture;
    let currentUrl: string | undefined;
    try {
      currentUrl = done ? undefined : handle.currentUrl();
    } catch {
      currentUrl = undefined;
    }
    return {
      state: done ? "done" : "open",
      ...(currentUrl ? { currentUrl } : {}),
      captured: handle
        .captures()
        .filter((m) => !m.themeOnly)
        .map((m) => ({ id: m.id, url: m.finalUrl || m.url, title: m.title })),
    };
  }

  async function startCapture(): Promise<InitCapture> {
    const url = created?.answers.captureUrl;
    if (!created || !url) throw new HttpError(409, "There is no page to capture.");
    if (capture || captureProblem) return captureState();
    const folderId = (await loadDesignFolder(created.design.folder)).config.folderId;
    try {
      const handle = await startCaptureSession({
        folderRoot: created.design.folder,
        ...(folderId ? { folderId } : {}),
        url,
        sessionStatePath: sessionStatePath(created.design.folder, new URL(url).origin, folderId),
      });
      const session = { handle, done: false };
      capture = session;
      void handle.finished.then(() => {
        session.done = true;
      });
    } catch (error) {
      captureProblem =
        error instanceof HeadedBrowserMissingError
          ? error.message
          : `The browser window didn't open: ${(error as Error).message}`;
    }
    return captureState();
  }

  /** Close the window, and name what it captured in the agent's first task. */
  async function finishCapture(): Promise<{ prompt?: string }> {
    if (!created) throw new HttpError(409, "Create the design first.");
    const captured = captureState().captured.map((c) => c.url);
    if (capture && !capture.done) {
      await capture.handle.close().catch(() => undefined);
      capture.done = true;
    }
    if (captured.length > 0) {
      const answers: WizardAnswers = {
        ...created.answers,
        captured,
        customRequest: `Recreate the pages I captured from ${created.answers.captureUrl}, then explore alternatives.`,
      };
      const prompt = firstPrompt(answers, created.design.scaffold.screens);
      created = { ...created, answers, ...(prompt ? { prompt } : {}) };
    }
    return created.prompt ? { prompt: created.prompt } : {};
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
      const answer: InitPlace = {
        folder: place.managedId
          ? displayPath(place.folder)
          : relative(opts.launchRoot, place.folder) || ".",
        local: isLocal(place),
        ...(problem ? { problem } : {}),
      };
      return json(answer);
    }
    if (req.method === "POST" && path === "/api/init/create") return json(await create(req));
    if (req.method === "GET" && path === "/api/init/agents") return json(await providers());
    if (req.method === "POST" && path === "/api/init/models") return json(await models(req));
    if (req.method === "POST" && path === "/api/init/open") return json(await open(req));
    if (req.method === "GET" && path === "/api/init/capture") return json(captureState());
    if (req.method === "POST" && path === "/api/init/capture/start")
      return json(await startCapture());
    if (req.method === "POST" && path === "/api/init/capture/finish")
      return json(await finishCapture());
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
