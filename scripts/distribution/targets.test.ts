import { describe, expect, test } from "bun:test";
import { BUN_VERSION, currentRuntimeTarget, RUNTIME_TARGETS, runtimeTarget } from "./targets.ts";

describe("official Bun runtime targets", () => {
  test("pins Bun 1.4 and covers npm's macOS, Linux, musl, and Windows matrix", () => {
    expect(BUN_VERSION).toBe("1.4.0");
    expect(RUNTIME_TARGETS.map((target) => target.id)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-arm64-musl",
      "linux-x64",
      "linux-x64-musl",
      "win32-arm64",
      "win32-x64",
    ]);
  });

  test("every target uses a unique official package and baseline x64 build", () => {
    expect(new Set(RUNTIME_TARGETS.map((target) => target.packageName)).size).toBe(
      RUNTIME_TARGETS.length,
    );
    for (const target of RUNTIME_TARGETS) {
      expect(target.packageName).toStartWith("@oven/bun-");
      if (target.cpu === "x64") {
        expect(target.packageName).toContain("baseline");
      }
    }
  });

  test("lookup is exact and this machine resolves to a supported target", () => {
    const current = currentRuntimeTarget();
    expect(runtimeTarget(current.id)).toBe(current);
    expect(() => runtimeTarget("plan9-x64")).toThrow(/unknown runtime target/);
  });
});
