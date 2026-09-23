import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredential } from "../cloud-credentials.ts";
import type { DeviceLoginResult } from "../cloud-login.ts";
import { createCanvasAuth } from "../daemon/canvas-auth.ts";

/**
 * The settings menu's "Open velloo-cloud" item reads `appUrl` off auth status,
 * which the daemon takes from the cloud's `/v1/auth/config`.
 */

let tmp: string;
let credentialsPath = "";
const realFetch = globalThis.fetch;
const CLOUD = "https://cloud.example.test";

beforeEach(async () => {
  tmp = join(tmpdir(), `velloo-canvas-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
  credentialsPath = join(tmp, "credentials.json");
  process.env.VELLOO_CREDENTIALS_PATH = credentialsPath;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.VELLOO_CREDENTIALS_PATH;
  await rm(tmp, { recursive: true, force: true });
});

function stubFetch(handlers: Record<string, unknown>): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [suffix, body] of Object.entries(handlers)) {
      if (url.includes(suffix)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

function controlledDeviceLogin() {
  let approve!: (result: DeviceLoginResult) => void;
  let deny!: (error: Error) => void;
  const outcome = new Promise<DeviceLoginResult>((resolve, reject) => {
    approve = resolve;
    deny = reject;
  });
  return {
    approve,
    deny,
    performDeviceLogin: async (
      _cloudUrl: string,
      onPrompt: (info: {
        verificationUrl: string;
        userCode: string;
        expiresIn: number;
      }) => void | Promise<void>,
      signal?: AbortSignal,
    ) => {
      signal?.addEventListener("abort", () => deny(new Error("cancelled")), { once: true });
      await onPrompt({
        verificationUrl: "https://app.example.test/device?user_code=WDJB-MJHT",
        userCode: "WDJB-MJHT",
        expiresIn: 1800,
      });
      return outcome;
    },
  };
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await Bun.sleep(5);
  }
  throw new Error("timed out waiting for canvas auth transition");
}

describe("createCanvasAuth status appUrl", () => {
  test("uses the home the cloud advertises, even while signed out", async () => {
    stubFetch({
      "/v1/auth/config": {
        issuer: "https://auth.example.test",
        clientId: "cli",
        appUrl: "https://app.example.test",
      },
    });
    const status = await createCanvasAuth(CLOUD).status();
    expect(status.loggedIn).toBe(false);
    expect(status.cloudUrl).toBe(CLOUD);
    expect(status.appUrl).toBe("https://app.example.test");
  });

  test("falls back to the API origin when the cloud omits a home", async () => {
    stubFetch({
      "/v1/auth/config": { issuer: "https://auth.example.test", clientId: "cli" },
    });
    const status = await createCanvasAuth(CLOUD).status();
    expect(status.appUrl).toBe(CLOUD);
  });

  test("keeps the advertised home once a credential is stored", async () => {
    await writeFile(
      credentialsPath,
      JSON.stringify({
        version: 1,
        clouds: {
          [CLOUD]: { token: "vlk_test", email: "a@b.dev" },
        },
      }),
    );
    stubFetch({
      "/v1/auth/config": {
        issuer: "https://auth.example.test",
        clientId: "cli",
        appUrl: "https://app.example.test",
      },
      "/v1/me": { email: "a@b.dev", name: "A", tier: "free" },
    });

    const status = await createCanvasAuth(CLOUD).status();
    expect(status.loggedIn).toBe(true);
    expect(status.appUrl).toBe("https://app.example.test");
    expect(status.account?.email).toBe("a@b.dev");
  });
});

describe("createCanvasAuth logout", () => {
  test("signs the token out at the cloud before forgetting it", async () => {
    await writeFile(
      credentialsPath,
      JSON.stringify({ version: 1, clouds: { [CLOUD]: { token: "vlk_live", email: "a@b.dev" } } }),
    );
    const revoked: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === `${CLOUD}/v1/auth/cli-token` && init?.method === "DELETE") {
        revoked.push(new Headers(init.headers).get("authorization") ?? "");
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    await createCanvasAuth(CLOUD).logout();
    expect(revoked).toEqual(["Bearer vlk_live"]);
    expect(await loadCredential(CLOUD)).toBeNull();
  });

  test("still forgets the token when the cloud cannot be reached", async () => {
    await writeFile(
      credentialsPath,
      JSON.stringify({ version: 1, clouds: { [CLOUD]: { token: "vlk_live", email: "a@b.dev" } } }),
    );
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await createCanvasAuth(CLOUD).logout();
    expect(await loadCredential(CLOUD)).toBeNull();
  });
});

describe("createCanvasAuth device login", () => {
  test("keeps a replacement login pending until the device code is approved", async () => {
    await writeFile(
      credentialsPath,
      JSON.stringify({
        version: 1,
        clouds: { [CLOUD]: { token: "vlk_expired", email: "old@b.dev" } },
      }),
    );
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/v1/auth/config")) {
        return Response.json({
          issuer: "https://auth.example.test",
          clientId: "cli",
          appUrl: "https://app.example.test",
        });
      }
      if (url.includes("/v1/me")) {
        return init?.headers && new Headers(init.headers).get("authorization") === "Bearer vlk_new"
          ? Response.json({ email: "new@b.dev", name: "New" })
          : new Response("unauthorized", { status: 401 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const flow = controlledDeviceLogin();
    const auth = createCanvasAuth(CLOUD, { performDeviceLogin: flow.performDeviceLogin });
    const pending = await auth.beginLogin();

    expect(pending.loggedIn).toBe(true);
    expect(pending.verified).toBe(false);
    expect(pending.login).toMatchObject({ state: "pending", userCode: "WDJB-MJHT" });
    expect(await loadCredential(CLOUD)).toEqual({ token: "vlk_expired", email: "old@b.dev" });

    flow.approve({ token: "vlk_new", email: "new@b.dev" });
    // Wait on the state machine, not the credential file: the token lands on
    // disk a tick before `login` falls back to idle, so watching the file left
    // a window where the login still read as pending.
    await waitFor(async () => (await auth.status()).login.state === "idle");

    const approved = await auth.status();
    expect(approved.loggedIn).toBe(true);
    expect(approved.verified).toBe(true);
    expect(approved.login).toEqual({ state: "idle" });
    expect(approved.account?.email).toBe("new@b.dev");
    expect(await loadCredential(CLOUD)).toMatchObject({ token: "vlk_new" });
  });

  test("denial does not persist a credential", async () => {
    stubFetch({
      "/v1/auth/config": {
        issuer: "https://auth.example.test",
        clientId: "cli",
        appUrl: "https://app.example.test",
      },
    });
    const flow = controlledDeviceLogin();
    const auth = createCanvasAuth(CLOUD, { performDeviceLogin: flow.performDeviceLogin });
    expect((await auth.beginLogin()).login.state).toBe("pending");

    flow.deny(new Error("access denied"));
    await waitFor(async () => (await auth.status()).login.state === "error");

    const denied = await auth.status();
    expect(denied.loggedIn).toBe(false);
    expect(denied.login).toEqual({ state: "error", message: "access denied" });
    expect(await loadCredential(CLOUD)).toBeNull();
  });

  test("cancellation does not persist a credential", async () => {
    stubFetch({
      "/v1/auth/config": {
        issuer: "https://auth.example.test",
        clientId: "cli",
        appUrl: "https://app.example.test",
      },
    });
    const flow = controlledDeviceLogin();
    const auth = createCanvasAuth(CLOUD, { performDeviceLogin: flow.performDeviceLogin });
    expect((await auth.beginLogin()).login.state).toBe("pending");

    await auth.cancelLogin();
    const cancelled = await auth.status();
    expect(cancelled.loggedIn).toBe(false);
    expect(cancelled.login).toEqual({ state: "idle" });
    expect(await loadCredential(CLOUD)).toBeNull();
  });
});
