import { describe, expect, test } from "bun:test";
import { actionForRunKey, shouldStayForeground } from "../run-foreground.ts";

describe("shouldStayForeground", () => {
  test("stays attached on a TTY unless --background was passed", () => {
    expect(shouldStayForeground({ background: false, stdinIsTTY: true })).toBe(true);
    expect(shouldStayForeground({ background: true, stdinIsTTY: true })).toBe(false);
    expect(shouldStayForeground({ background: false, stdinIsTTY: false })).toBe(false);
    expect(shouldStayForeground({ background: true, stdinIsTTY: false })).toBe(false);
  });
});

describe("actionForRunKey", () => {
  test("maps the printed shortcuts", () => {
    expect(actionForRunKey("b")).toBe("background");
    expect(actionForRunKey("s")).toBe("stop");
    expect(actionForRunKey("o")).toBe("open");
    expect(actionForRunKey("\u0003")).toBe("stop");
  });

  test("ignores uppercase, arrows, and other keys", () => {
    // Down-arrow CSI can split and deliver a trailing `B`.
    expect(actionForRunKey("B")).toBeNull();
    expect(actionForRunKey("S")).toBeNull();
    expect(actionForRunKey("O")).toBeNull();
    expect(actionForRunKey("\u001b[B")).toBeNull();
    expect(actionForRunKey("q")).toBeNull();
    expect(actionForRunKey("\r")).toBeNull();
  });
});
