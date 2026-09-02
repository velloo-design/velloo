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
  test("maps the printed shortcuts for one canvas", () => {
    expect(actionForRunKey("b")).toEqual({ kind: "background" });
    expect(actionForRunKey("q")).toEqual({ kind: "stop" });
    expect(actionForRunKey("o")).toEqual({ kind: "open" });
    expect(actionForRunKey("")).toEqual({ kind: "stop" });
  });

  test("digits and `a` only mean something with several canvases", () => {
    expect(actionForRunKey("1")).toBeNull();
    expect(actionForRunKey("a")).toBeNull();
    expect(actionForRunKey("1", 3)).toEqual({ kind: "open", index: 1 });
    expect(actionForRunKey("3", 3)).toEqual({ kind: "open", index: 3 });
    expect(actionForRunKey("a", 3)).toEqual({ kind: "open" });
    // `o` keeps working as "open" — it opens all when there are several.
    expect(actionForRunKey("o", 3)).toEqual({ kind: "open" });
  });

  test("a digit past the last canvas is ignored, not wrapped", () => {
    expect(actionForRunKey("4", 3)).toBeNull();
    expect(actionForRunKey("9", 3)).toBeNull();
    expect(actionForRunKey("0", 3)).toBeNull();
  });

  test("ignores uppercase, arrows, and other keys", () => {
    // Down-arrow CSI can split and deliver a trailing `B`.
    expect(actionForRunKey("B")).toBeNull();
    expect(actionForRunKey("Q")).toBeNull();
    expect(actionForRunKey("O")).toBeNull();
    expect(actionForRunKey("[B")).toBeNull();
    // `s` was the stop key before it moved to `q` — it must not linger.
    expect(actionForRunKey("s")).toBeNull();
    expect(actionForRunKey("\r")).toBeNull();
  });
});
