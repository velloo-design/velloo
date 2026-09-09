import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { CanvasUpdateResult, CanvasUpdateStatus, CanvasUpdates } from "../../updates.ts";
import { createUpdatesRouter } from "../updates.ts";

/**
 * The canvas's upgrade endpoint. What matters here is what it refuses: an
 * embedder that supplied no controller must not look like "no update
 * available", and two upgrades must never run at once — a second
 * `npm install -g` racing the first over the same directory is how an
 * installation ends up half-written.
 */

const READY: CanvasUpdateStatus = {
  current: "0.1.0",
  latest: "0.2.0",
  available: true,
  method: "npm",
  channel: "stable",
  upgradable: true,
};

function app(updates?: CanvasUpdates): Hono {
  const root = new Hono();
  root.route("/api/updates", createUpdatesRouter(updates));
  return root;
}

describe("updates route", () => {
  test("says so plainly when nothing can update this server", async () => {
    const server = app();
    const status = await server.request("/api/updates/status");
    expect(status.status).toBe(200);
    const body = (await status.json()) as CanvasUpdateStatus;
    expect(body.upgradable).toBe(false);
    expect(body.available).toBe(false);
    expect(body.reason).toContain("cannot update itself");

    const upgrade = await server.request("/api/updates", { method: "POST" });
    expect(upgrade.status).toBe(503);
  });

  test("passes the refresh flag through, so a UI poll never forces a network call", async () => {
    const seen: (boolean | undefined)[] = [];
    const server = app({
      status: async (opts) => {
        seen.push(opts?.refresh);
        return READY;
      },
      upgrade: async () => ({
        upgraded: false,
        from: "0.1.0",
        to: "0.1.0",
        restartRequired: false,
      }),
    });
    await server.request("/api/updates/status");
    await server.request("/api/updates/status?refresh=1");
    expect(seen).toEqual([false, true]);
  });

  test("refuses a concurrent upgrade rather than running two installers", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result: CanvasUpdateResult = {
      upgraded: true,
      from: "0.1.0",
      to: "0.2.0",
      restartRequired: true,
    };
    const server = app({
      status: async () => READY,
      upgrade: async () => {
        await gate;
        return result;
      },
    });

    const first = server.request("/api/updates", { method: "POST" });
    const second = await server.request("/api/updates", { method: "POST" });
    expect(second.status).toBe(409);
    release?.();
    expect(await (await first).json()).toEqual(result);

    // …and the lock lifts, so a failed or finished upgrade doesn't wedge it.
    const third = await server.request("/api/updates", { method: "POST" });
    expect(third.status).toBe(200);
  });

  test("reports an upgrade failure as an error envelope, not a crash", async () => {
    const server = app({
      status: async () => READY,
      upgrade: async () => {
        throw new Error("npm exited with status 1");
      },
    });
    const response = await server.request("/api/updates", { method: "POST" });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { kind: string; message: string } };
    expect(body.error.kind).toBe("upgrade_failed");
    expect(body.error.message).toContain("npm exited");
  });
});
