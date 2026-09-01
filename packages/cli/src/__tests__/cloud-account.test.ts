import { afterEach, describe, expect, test } from "bun:test";
import { fetchAccount } from "../cloud-login.ts";

/**
 * `/v1/me` → the account the canvas's settings menu renders. The credit
 * balance rides along with it: image generation spends real money per click,
 * so "how much is left" has to be answerable without running a generation to
 * find out.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubMe(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("fetchAccount", () => {
  test("carries the credit balance through to the canvas", async () => {
    stubMe({ email: "a@b.dev", name: "A", tier: "free", creditMicros: 1_260_000 });
    const r = await fetchAccount("https://cloud.test", "vlk_t");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.account.creditMicros).toBe(1_260_000);
    expect(r.account.email).toBe("a@b.dev");
    expect(r.account.tier).toBe("free");
  });

  test("a null balance is kept — the cloud couldn't price it, which isn't zero", async () => {
    // The account service briefly down: /v1/me answers with creditMicros: null rather
    // than failing the whole account read, and the menu shows "—", not "$0.00".
    stubMe({ email: "a@b.dev", creditMicros: null });
    const r = await fetchAccount("https://cloud.test", "vlk_t");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.account.creditMicros).toBeNull();
    expect("creditMicros" in r.account).toBe(true);
  });

  test("a cloud that doesn't report a balance omits it rather than inventing one", async () => {
    stubMe({ email: "a@b.dev", tier: "free" });
    const r = await fetchAccount("https://cloud.test", "vlk_t");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect("creditMicros" in r.account).toBe(false);
  });

  test("only the cloud saying 'not you' is a rejection", async () => {
    stubMe({}, 401);
    expect((await fetchAccount("https://cloud.test", "vlk_t")).status).toBe("rejected");
    // A 5xx is the cloud's problem — it must not log the canvas out.
    stubMe({}, 503);
    expect((await fetchAccount("https://cloud.test", "vlk_t")).status).toBe("unreachable");
  });

  test("an insecure cloud URL never sees the token", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect((await fetchAccount("http://cloud.test", "vlk_t")).status).toBe("unreachable");
    expect(called).toBe(false);
  });
});
