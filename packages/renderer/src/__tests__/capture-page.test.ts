import { describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { capturePagePng } from "../capture-page.ts";

describe("capturePagePng", () => {
  test("retries Chromium's transient CDP screenshot rejection once", async () => {
    const png = Buffer.from("png");
    let attempts = 0;
    const page = {
      async screenshot() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(
            "screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
          );
        }
        return png;
      },
    } as unknown as Page;

    expect(await capturePagePng(page, true)).toBe(png);
    expect(attempts).toBe(2);
  });

  test("does not retry unrelated screenshot failures", async () => {
    let attempts = 0;
    const page = {
      async screenshot() {
        attempts += 1;
        throw new Error("Target closed");
      },
    } as unknown as Page;

    await expect(capturePagePng(page, true)).rejects.toThrow("Target closed");
    expect(attempts).toBe(1);
  });
});
