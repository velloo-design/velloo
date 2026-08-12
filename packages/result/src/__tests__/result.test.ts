import { describe, expect, test } from "bun:test";
import {
  $,
  catchKind,
  combine,
  Do,
  DoAsync,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  mapError,
  match,
  ok,
  type Result,
  recover,
  tap,
  tapError,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapOr,
} from "../index.ts";

type TestError =
  | { kind: "NotFound"; what: string }
  | { kind: "Invalid"; reason: string }
  | { kind: "Network"; status: number };

describe("Result", () => {
  describe("constructors + predicates", () => {
    test("ok / isOk", () => {
      const r = ok(42);
      expect(r.ok).toBe(true);
      expect(isOk(r)).toBe(true);
      expect(isErr(r)).toBe(false);
      if (r.ok) expect(r.value).toBe(42);
    });

    test("err / isErr", () => {
      const r = err<TestError>({ kind: "NotFound", what: "x" });
      expect(r.ok).toBe(false);
      expect(isErr(r)).toBe(true);
      expect(isOk(r)).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("NotFound");
    });
  });

  describe("transforms", () => {
    test("map only fires on ok", () => {
      expect(map(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
      const r = map(err<TestError>({ kind: "Invalid", reason: "x" }), (n: number) => n * 3);
      expect(r.ok).toBe(false);
    });

    test("mapError only fires on err", () => {
      const r = mapError(err<TestError>({ kind: "Invalid", reason: "x" }), (e) => ({
        kind: "Network" as const,
        status: 400,
        cause: e,
      }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.status).toBe(400);
      const passThrough = mapError(ok(1), (e: TestError) => e);
      expect(passThrough).toEqual({ ok: true, value: 1 });
    });

    test("flatMap chains", () => {
      const parse = (s: string): Result<number, TestError> => {
        const n = Number(s);
        return Number.isFinite(n) ? ok(n) : err({ kind: "Invalid", reason: `bad: ${s}` });
      };
      const positive = (n: number): Result<number, TestError> =>
        n > 0 ? ok(n) : err({ kind: "Invalid", reason: "must be > 0" });

      expect(flatMap(parse("5"), positive)).toEqual({ ok: true, value: 5 });
      const bad = flatMap(parse("-1"), positive);
      expect(bad.ok).toBe(false);
      const worse = flatMap(parse("abc"), positive);
      expect(worse.ok).toBe(false);
      if (!worse.ok && worse.error.kind === "Invalid") expect(worse.error.reason).toContain("bad");
    });
  });

  describe("side effects", () => {
    test("tap fires only on ok", () => {
      let seen = 0;
      tap(ok(7), (v) => {
        seen = v;
      });
      expect(seen).toBe(7);
      tap(err<TestError>({ kind: "Invalid", reason: "x" }), () => {
        seen = -1;
      });
      expect(seen).toBe(7);
    });

    test("tapError fires only on err", () => {
      const seen: string[] = [];
      tapError(err<TestError>({ kind: "Invalid", reason: "boom" }), (e) => {
        if (e.kind === "Invalid") seen.push(e.reason);
      });
      expect(seen).toEqual(["boom"]);
    });
  });

  describe("recovery", () => {
    test("catchKind narrows the union at the type level + recovers at runtime", () => {
      const r = err<TestError>({ kind: "NotFound", what: "page" });
      const fixed = catchKind(r, "NotFound", () => 0);
      expect(fixed).toEqual({ ok: true, value: 0 });

      // Type-level: the resulting error type no longer contains "NotFound".
      if (!fixed.ok) {
        const k: "Invalid" | "Network" = fixed.error.kind;
        expect(k).toBeDefined();
      }
    });

    test("catchKind passes through other err variants untouched", () => {
      const r = err<TestError>({ kind: "Invalid", reason: "x" });
      const fixed = catchKind(r, "NotFound", () => 0);
      expect(fixed.ok).toBe(false);
      if (!fixed.ok) expect(fixed.error.kind).toBe("Invalid");
    });

    test("recover collapses every error to ok", () => {
      const r = recover(err<TestError>({ kind: "Invalid", reason: "x" }), () => 42);
      expect(r).toEqual({ ok: true, value: 42 });
    });
  });

  describe("terminal", () => {
    test("match dispatches on shape", () => {
      const seenOk = match(ok(1), { ok: (v) => `got ${v}`, err: () => "no" });
      expect(seenOk).toBe("got 1");
      const seenErr = match(err<TestError>({ kind: "Invalid", reason: "x" }), {
        ok: () => "ok",
        err: (e) => `bad: ${e.kind}`,
      });
      expect(seenErr).toBe("bad: Invalid");
    });

    test("unwrap returns value or throws", () => {
      expect(unwrap(ok(99))).toBe(99);
      expect(() => unwrap(err({ kind: "X" }))).toThrow();
    });

    test("unwrapOr falls back on err", () => {
      expect(unwrapOr(ok(1), 0)).toBe(1);
      expect(unwrapOr(err<TestError>({ kind: "Invalid", reason: "x" }), 0)).toBe(0);
    });
  });

  describe("combine", () => {
    test("happy path preserves tuple types", () => {
      const r = combine([ok(1), ok("two"), ok(true)] as const);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const [a, b, c] = r.value;
        expect(a).toBe(1);
        expect(b).toBe("two");
        expect(c).toBe(true);
      }
    });

    test("fails fast on the first err", () => {
      const inputs: ReadonlyArray<Result<number, TestError>> = [
        ok(1),
        err({ kind: "Invalid", reason: "second" }),
        ok(3),
      ];
      const r = combine(inputs);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const error = r.error as TestError;
        expect(error.kind).toBe("Invalid");
      }
    });
  });

  describe("tryCatch", () => {
    test("captures throws into err", () => {
      const r = tryCatch(
        () => {
          throw new Error("boom");
        },
        (e) => ({ kind: "Invalid" as const, reason: String(e) }),
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.reason).toContain("boom");
    });

    test("passes ok through", () => {
      expect(
        tryCatch(
          () => 5,
          () => ({ kind: "X" }),
        ),
      ).toEqual({ ok: true, value: 5 });
    });

    test("tryCatchAsync handles rejection", async () => {
      const r = await tryCatchAsync(
        async () => {
          throw new Error("async boom");
        },
        (e) => ({ kind: "Invalid" as const, reason: String(e) }),
      );
      expect(r.ok).toBe(false);
    });
  });

  describe("Do / $", () => {
    test("synchronous Do composes results", () => {
      const r = Do<number, TestError>(function* () {
        const a = yield* $(ok(1));
        const b = yield* $(ok(2));
        return a + b;
      });
      expect(r).toEqual({ ok: true, value: 3 });
    });

    test("Do short-circuits on first err", () => {
      let after = 0;
      const r = Do<number, TestError>(function* () {
        const a = yield* $(ok(1));
        yield* $(err<TestError>({ kind: "NotFound", what: "x" }));
        after++;
        return a + 99;
      });
      expect(r.ok).toBe(false);
      expect(after).toBe(0);
      if (!r.ok) expect(r.error.kind).toBe("NotFound");
    });

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
