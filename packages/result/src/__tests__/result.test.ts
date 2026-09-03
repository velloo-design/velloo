import { describe, expect, test } from "bun:test";
import {
  $,
  catchKind,
  Do,
  DoAsync,
  err,
  map,
  mapError,
  ok,
  type Result,
  tryCatch,
  tryCatchAsync,
  unwrap,
} from "../index.ts";

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

describe("mapError", () => {
  test("translates the error and leaves ok untouched", () => {
    type A = { kind: "A"; n: number };
    type B = { kind: "B"; label: string };
    const toB = (a: A): B => ({ kind: "B", label: `a${a.n}` });

    expect(mapError(ok<number>(1), toB)).toEqual(ok(1));
    expect(mapError(err<A>({ kind: "A", n: 2 }), toB)).toEqual(err({ kind: "B", label: "a2" }));
  });
});

describe("catchKind", () => {
  type E = { kind: "Missing"; id: string } | { kind: "Broken"; why: string };

  test("recovers the named variant", () => {
    const r = catchKind(err<E>({ kind: "Missing", id: "x" }), "Missing", (e) => `made ${e.id}`);
    expect(r).toEqual(ok("made x"));
  });

  test("passes other variants through", () => {
    const r = catchKind(err<E>({ kind: "Broken", why: "nope" }), "Missing", () => "unused");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("Broken");
  });

  test("leaves ok untouched", () => {
    expect(catchKind<number, E, "Missing", number>(ok(7), "Missing", () => 0)).toEqual(ok(7));
  });

  test("narrows the remaining error union at the type level", () => {
    const r = catchKind(err<E>({ kind: "Broken", why: "nope" }), "Missing", () => 0);
    if (!r.ok) {
      // `Missing` is gone from the union: this assignment only compiles
      // because the remaining error is exactly `Broken`.
      const remaining: { kind: "Broken"; why: string } = r.error;
      expect(remaining.kind).toBe("Broken");
    }
  });
});

describe("tryCatch", () => {
  test("wraps a return value", () => {
    expect(
      tryCatch(
        () => 42,
        () => "boom",
      ),
    ).toEqual(ok(42));
  });

  test("wraps a throw", () => {
    const r = tryCatch(
      () => {
        throw new Error("kaboom");
      },
      (e) => (e instanceof Error ? e.message : "unknown"),
    );
    expect(r).toEqual(err("kaboom"));
  });
});

describe("Do", () => {
  test("threads values through and short-circuits on the first err", () => {
    const good = Do<number, string>(function* () {
      const a = yield* $(ok(2));
      const b = yield* $(ok(3));
      return a * b;
    });
    expect(good).toEqual(ok(6));

    let reached = false;
    const bad = Do<number, string>(function* () {
      const a = yield* $(ok(2));
      yield* $(err<string>("stop"));
      reached = true;
      return a;
    });
    expect(bad).toEqual(err("stop"));
    expect(reached).toBe(false);
  });
});
