import { describe, expect, test } from "bun:test";
import { normalizeCaptureUrl } from "../commands/capture.ts";

describe("normalizeCaptureUrl", () => {
  test("accepts a bare domain the way a person would type it", () => {
    expect(normalizeCaptureUrl("kiro.dev")).toBe("https://kiro.dev/");
    expect(normalizeCaptureUrl("app.example.com/pricing")).toBe("https://app.example.com/pricing");
  });

  test("keeps an explicit scheme", () => {
    expect(normalizeCaptureUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeCaptureUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  });

  test("a local dev server gets http, not https", () => {
    // `localhost:3000` also parses as a URL with protocol "localhost:", which
    // is why the scheme is detected by shape rather than by parsing.
    expect(normalizeCaptureUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeCaptureUrl("127.0.0.1:5173/dashboard")).toBe("http://127.0.0.1:5173/dashboard");
    expect(normalizeCaptureUrl("localhost")).toBe("http://localhost/");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeCaptureUrl("  kiro.dev  ")).toBe("https://kiro.dev/");
  });

  test("rejects anything that isn't an http(s) page", () => {
    expect(normalizeCaptureUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeCaptureUrl("chrome://settings")).toBeNull();
    expect(normalizeCaptureUrl("javascript://alert(1)")).toBeNull();
    expect(normalizeCaptureUrl("")).toBeNull();
    expect(normalizeCaptureUrl("   ")).toBeNull();
  });
});
