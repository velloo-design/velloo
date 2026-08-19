import { describe, expect, test } from "bun:test";
import { $, DoAsync, err, map, ok, type Result, tryCatchAsync, unwrap } from "../index.ts";

type TestError =
  | { kind: "NotFound"; what: string }
  | { kind: "Invalid"; reason: string }
  | { kind: "Network"; status: number };

describe("Result", () => {
  describe("constructors", () => {
    test("ok", () => {
      const r = ok(42);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42);
    });

    test("err", () => {
      const r = err<TestError>({ kind: "NotFound", what: "x" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("NotFound");
    });
  });

  describe("transforms", () => {
    test("map only fires on ok", () => {
      expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
      const r = map(err<TestError>({ kind: "Invalid", reason: "x" }), (n: number) => n * 3);
      expect(r.ok).toBe(false);
    });
  });

  describe("terminal", () => {
    test("unwrap returns value or throws", () => {
      expect(unwrap(ok(99))).toBe(99);
      expect(() => unwrap(err({ kind: "X" }))).toThrow();
    });
  });

  describe("boundary", () => {
    test("tryCatchAsync handles rejection", async () => {
      const r = await tryCatchAsync(
        async () => {
          throw new Error("async boom");
        },
        (e) => ({ kind: "Invalid" as const, reason: String(e) }),
      );
      expect(r.ok).toBe(false);
    });

    test("tryCatchAsync passes ok through", async () => {
      const r = await tryCatchAsync(
        async () => 5,
        () => ({ kind: "X" }),
      );
      expect(r).toEqual({ ok: true, value: 5 });
    });
  });

  describe("DoAsync / $", () => {
    test("DoAsync composes async results", async () => {
      const fetchOne = async (): Promise<Result<number, TestError>> => ok(10);
      const fetchTwo = async (): Promise<Result<number, TestError>> => ok(20);
      const r = await DoAsync<number, TestError>(async function* () {
        const a = yield* $(await fetchOne());
        const b = yield* $(await fetchTwo());
        return a + b;
      });
      expect(r).toEqual({ ok: true, value: 30 });
    });

    test("DoAsync short-circuits on first err", async () => {
      const r = await DoAsync<number, TestError>(async function* () {
        yield* $(ok(1));
        yield* $(err<TestError>({ kind: "Network", status: 500 }));
        return 42;
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("Network");
    });
  });
});
