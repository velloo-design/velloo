import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/shadcn-snapshot";
import type { Hono } from "hono";
import { createApp } from "../app.ts";
import type {
  CanvasAuth,
  CanvasAuthStatus,
  CanvasCloudAccess,
  CanvasPublish,
  CanvasPublishProgress,
  CanvasPublishRequest,
  CanvasPublishResult,
  PublishHost,
} from "../cloud.ts";
import { signInRequired } from "../cloud.ts";
import { type DesignFolder, loadDesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import type { MutationContext } from "../mutations/index.ts";
import { PublishRunner } from "../publish-run.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";

/**
 * The canvas's cloud surface: /api/auth (account state + in-canvas sign-in) and
 * /api/publish (one publish at a time, with pollable progress).
 *
 * Both are backed by CLI-injected controllers — the server holds no credential
 * and performs no upload — so these suites drive fake controllers and assert the
 * contract the canvas actually depends on, including the no-controller
 * fallbacks an embedder without a CLI hits.
 */

const provider = createShadcnProvider();

const sampleConfig = {
  schemaVersion: 3,
  toolVersion: "0.1.0",
  libraries: {
    default: {
      id: "shadcn-upstream" as const,
      version: "test",
      source: "binary",
      componentsPath: "binary",
    },
  },
  defaultLibrary: "default",
  viewportPresets: [{ name: "Desktop", w: 1440, h: 900 }],
};

const sampleTheme = {
  name: "default",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    primary: { DEFAULT: "oklch(0.55 0.18 280)", foreground: "oklch(0.985 0 0)" },
  },
  typography: {},
  spacing: {},
  radius: {},
};

let tmp: string;
let folder: DesignFolder;

const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-cloud-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  for (const dir of [".design", "theme", "screens", "boards"]) {
    await mkdir(join(tmp, dir), { recursive: true });
  }
  await writeJson(join(tmp, ".design/config.json"), sampleConfig);
  await writeJson(join(tmp, "theme/default.json"), sampleTheme);
  await writeJson(join(tmp, "screens/home.json"), {
    id: "home",
    name: "Home",
    tree: { $ref: "Box", children: [] },
  });
  folder = await loadDesignFolder(tmp);
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** The app under test, with whichever controllers a suite wants behind it. */
function appWith(opts: { auth?: CanvasAuth; publish?: PublishRunner } = {}): Hono {
  const jit = new TailwindJit(provider, join(folder.root, "screens"));
  const bundler = new LiveBundler(
    folder.root,
    () => folder.config,
    () => liveExtensions(folder.config.extensions),
  );
  const canvasBundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    () => undefined,
  );
  const ctx: MutationContext = {
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    broadcast: () => undefined,
  };
  return createApp(() => ctx, jit, bundler, canvasBundler, opts.auth, opts.publish);
}

const get = (app: Hono, path: string) => app.fetch(new Request(`http://localhost${path}`));
const post = (app: Hono, path: string, body?: unknown) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
  );

describe("/api/auth without a CLI controller", () => {
  test("reports logged out in the full status shape", async () => {
    const res = await get(appWith(), "/api/auth/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      loggedIn: false,
      verified: null,
      login: { state: "idle" },
    });
  });

  test("sign-in is refused rather than silently failing", async () => {
    expect((await post(appWith(), "/api/auth/login")).status).toBe(503);
  });

  test("logout and cancel stay harmless no-ops", async () => {
    expect((await post(appWith(), "/api/auth/logout")).status).toBe(200);
    expect((await post(appWith(), "/api/auth/login/cancel")).status).toBe(200);
  });
});

describe("/api/auth with a CLI controller", () => {
  let calls: string[];
  let status: CanvasAuthStatus;
  let auth: CanvasAuth;

  beforeEach(() => {
    calls = [];
    status = {
      loggedIn: true,
      cloudUrl: "https://api.velloo.ai",
      appUrl: "https://velloo.ai",
      verified: true,
      login: { state: "idle" },
      account: { email: "designer@example.com", name: "Dana Designer", tier: "team" },
    };
    auth = {
      async status() {
        return status;
      },
      async beginLogin() {
        calls.push("beginLogin");
        status = {
          ...status,
          login: {
            state: "pending",
            userCode: "WDJB-MJHT",
            verificationUrl: "https://velloo.ai/device?user_code=WDJB-MJHT",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
        };
        return status;
      },
      async cancelLogin() {
        calls.push("cancelLogin");
      },
      async logout() {
        calls.push("logout");
      },
    };
  });

  test("status carries the account, plan, and which cloud it belongs to", async () => {
    const res = await get(appWith({ auth }), "/api/auth/status");
    expect(await res.json()).toMatchObject({
      loggedIn: true,
      cloudUrl: "https://api.velloo.ai",
      appUrl: "https://velloo.ai",
      verified: true,
      account: { email: "designer@example.com", name: "Dana Designer", tier: "team" },
    });
  });

  test("a token the cloud rejected is reported as unverified, still naming the account", async () => {
    status = { ...status, verified: false };
    const body = (await (
      await get(appWith({ auth }), "/api/auth/status")
    ).json()) as CanvasAuthStatus;
    expect(body.loggedIn).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.account?.email).toBe("designer@example.com");
  });

  test("sign-in returns the device code to show, and cancel/logout reach the controller", async () => {
    const app = appWith({ auth });
    const body = (await (await post(app, "/api/auth/login")).json()) as CanvasAuthStatus;
    expect(body.login).toMatchObject({ state: "pending", userCode: "WDJB-MJHT" });
    await post(app, "/api/auth/login/cancel");
    await post(app, "/api/auth/logout");
    expect(calls).toEqual(["beginLogin", "cancelLogin", "logout"]);
  });
});

/**
 * A publisher whose run is resolved by the test, so progress and completion can
 * be observed at exact points instead of raced against.
 */
function fakePublisher(
  opts: {
    access?: CanvasCloudAccess["state"];
    teams?: { id: string; name: string }[];
    destinationsFail?: unknown;
  } = {},
) {
  let settle: ((result: CanvasPublishResult) => void) | undefined;
  let fail: ((err: unknown) => void) | undefined;
  let emit: ((progress: CanvasPublishProgress) => void) | undefined;
  let warn: ((message: string) => void) | undefined;
  const requests: CanvasPublishRequest[] = [];
  let hostSeen: PublishHost | undefined;

  const publisher: CanvasPublish = {
    async access() {
      return { state: opts.access ?? "ready" };
    },
    async teams() {
      return opts.teams ?? [];
    },
    async destinations() {
      if (opts.destinationsFail) throw opts.destinationsFail;
      return {
        effectiveTeamId: null,
        provenance: { repo: null, branch: null },
        slots: [],
      };
    },
    run(host, request, onProgress, onWarning) {
      requests.push(request);
      hostSeen = host;
      emit = onProgress;
      warn = onWarning;
      return new Promise<CanvasPublishResult>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
    },
  };

  return {
    publisher,
    requests,
    host: () => hostSeen,
    progress: (progress: CanvasPublishProgress) => emit?.(progress),
    warn: (message: string) => warn?.(message),
    finish: (result: Partial<CanvasPublishResult> = {}) =>
      settle?.({
        shareUrl: "https://share.velloo.dev/s/abc/",
        visibility: "public",
        passwordProtected: false,
        files: 4,
        bytes: 2048,
        screenshots: 2,
        boards: 1,
        screens: 1,
        created: true,
        ...result,
      }),
    explode: (message: string) => fail?.(new Error(message)),
  };
}

const runnerFor = (publisher: CanvasPublish) =>
  new PublishRunner(publisher, () => ({
    folder,
    providers: { default: provider },
    defaultProvider: provider,
    snapshotCss: async () => "",
  }));

/** Let the runner's promise callbacks flush. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("/api/publish without a CLI publisher", () => {
  test("advertises that publishing isn't possible instead of offering a form", async () => {
    const app = appWith();
    expect(await (await get(app, "/api/publish/status")).json()).toEqual({ state: "unavailable" });
    expect(await (await get(app, "/api/publish/targets")).json()).toEqual({
      ready: false,
      access: "signed-out",
      teams: [],
      slots: [],
    });
    expect((await post(app, "/api/publish", { boardIds: [] })).status).toBe(503);
  });
});

describe("/api/publish", () => {
  test("targets carry sign-in state and the account's teams", async () => {
    const fake = fakePublisher({ teams: [{ id: "t1", name: "Design" }] });
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(await (await get(app, "/api/publish/targets")).json()).toEqual({
      ready: true,
      access: "ready",
      teams: [{ id: "t1", name: "Design" }],
      effectiveTeamId: null,
      provenance: { repo: null, branch: null },
      slots: [],
    });
  });

  test("a signed-out account offers no teams to publish into", async () => {
    const fake = fakePublisher({ access: "signed-out", teams: [{ id: "t1", name: "Design" }] });
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(await (await get(app, "/api/publish/targets")).json()).toEqual({
      ready: false,
      access: "signed-out",
      teams: [],
      slots: [],
    });
  });

  // The dialog's sign-in branch keys off `access`, so a credential the cloud
  // has rejected has to reach it as such — reporting `ready: true` is what let
  // a revoked token render the whole form and then fail on Publish.
  test("a rejected credential reads as expired, not as a working account", async () => {
    const fake = fakePublisher({ access: "expired", teams: [{ id: "t1", name: "Design" }] });
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(await (await get(app, "/api/publish/targets")).json()).toEqual({
      ready: false,
      access: "expired",
      teams: [],
      slots: [],
    });
  });

  // `access` is answered from a cached /v1/me verdict, so a token revoked
  // inside that window still reaches the destinations call.
  test("a 401 racing past the access check still lands on a sign-in", async () => {
    const fake = fakePublisher({
      destinationsFail: signInRequired("expired", "velloo-cloud rejected the stored credential"),
    });
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(await (await get(app, "/api/publish/targets")).json()).toEqual({
      ready: false,
      access: "expired",
      teams: [],
      slots: [],
    });
  });

  test("a destinations failure that is not about the credential stays an error", async () => {
    const fake = fakePublisher({ destinationsFail: new Error("cannot reach the cloud") });
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(await (await get(app, "/api/publish/targets")).json()).toMatchObject({
      ready: true,
      access: "ready",
      destinationError: "cannot reach the cloud",
    });
  });

  test("a run reports progress, capture counts, and the share URL when it lands", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });

    const started = await post(app, "/api/publish", {
      boardIds: ["main"],
      title: "Pulse designs",
      visibility: "private",
      destination: { mode: "new" },
      teamId: "t1",
      screenshots: true,
    });
    expect(started.status).toBe(202);
    expect(fake.requests[0]).toEqual({
      boardIds: ["main"],
      title: "Pulse designs",
      visibility: "private",
      destination: { mode: "new" },
      teamId: "t1",
      screenshots: true,
    });
    // The daemon lends its own loaded folder rather than reloading one.
    expect(fake.host()?.folder.root).toBe(folder.root);

    fake.progress({
      step: "capture",
      message: "capturing previews",
      capture: { done: 3, total: 8 },
    });
    fake.warn('screenshot of board "wide" exceeds 4MB even downscaled — skipped');
    expect(await (await get(app, "/api/publish/status")).json()).toMatchObject({
      state: "running",
      step: "capture",
      capture: { done: 3, total: 8 },
      warnings: ['screenshot of board "wide" exceeds 4MB even downscaled — skipped'],
    });

    fake.finish({ shareUrl: "https://share.velloo.dev/s/abc/" });
    await settled();
    expect(await (await get(app, "/api/publish/status")).json()).toMatchObject({
      state: "done",
      result: { shareUrl: "https://share.velloo.dev/s/abc/", boards: 1, created: true },
    });
  });

  test("a second publish is refused while one is running", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(
      (await post(app, "/api/publish", { boardIds: [], destination: { mode: "new" } })).status,
    ).toBe(202);
    expect(
      (await post(app, "/api/publish", { boardIds: [], destination: { mode: "new" } })).status,
    ).toBe(409);
    expect(fake.requests.length).toBe(1);

    // …and allowed again once the first one settles.
    fake.finish();
    await settled();
    expect(
      (await post(app, "/api/publish", { boardIds: [], destination: { mode: "new" } })).status,
    ).toBe(202);
  });

  test("a failure surfaces the publisher's own message", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    await post(app, "/api/publish", { boardIds: [], destination: { mode: "new" } });
    fake.explode("Contributor capability is required for this operation");
    await settled();
    expect(await (await get(app, "/api/publish/status")).json()).toMatchObject({
      state: "error",
      message: "Contributor capability is required for this operation",
    });
  });

  test("reset clears a settled run but never a live one", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    await post(app, "/api/publish", { boardIds: [], destination: { mode: "new" } });

    await post(app, "/api/publish/reset");
    expect(await (await get(app, "/api/publish/status")).json()).toMatchObject({
      state: "running",
    });

    fake.finish();
    await settled();
    await post(app, "/api/publish/reset");
    expect(await (await get(app, "/api/publish/status")).json()).toEqual({ state: "idle" });
  });

  test("a malformed request body still yields a well-formed publish", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    await post(app, "/api/publish", {
      boardIds: ["ok", 7, null],
      visibility: "sideways",
      destination: { mode: "new" },
    });
    // Junk ids are dropped, and an unknown visibility falls back to the safe default.
    expect(fake.requests[0]).toEqual({
      boardIds: ["ok"],
      visibility: "public",
      destination: { mode: "new" },
      screenshots: true,
    });
  });

  test("a publish cannot start without an explicit destination", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect((await post(app, "/api/publish", { boardIds: [] })).status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });

  test("share passwords require three characters", async () => {
    const fake = fakePublisher();
    const app = appWith({ publish: runnerFor(fake.publisher) });
    expect(
      (
        await post(app, "/api/publish", {
          boardIds: [],
          password: "no",
          destination: { mode: "new" },
        })
      ).status,
    ).toBe(400);
    expect(fake.requests).toHaveLength(0);

    expect(
      (
        await post(app, "/api/publish", {
          boardIds: [],
          password: "yes",
          destination: { mode: "new" },
        })
      ).status,
    ).toBe(202);
    expect(fake.requests[0]).toMatchObject({ password: "yes" });
  });
});
