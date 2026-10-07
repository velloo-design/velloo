import { describe, expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { capturePagePng, retryTransientScreenshot } from "../capture-page.ts";

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

  test("bounds the capture only when a timeout is given", async () => {
    const seen: unknown[] = [];
    const page = {
      async screenshot(options: unknown) {
        seen.push(options);
        return Buffer.from("png");
      },
    } as unknown as Page;

    await capturePagePng(page, false);
    await capturePagePng(page, true, 20_000);
    expect(seen).toEqual([
      { fullPage: false, animations: "disabled", caret: "hide" },
      { fullPage: true, animations: "disabled", caret: "hide", timeout: 20_000 },
    ]);
  });
});

describe("retryTransientScreenshot", () => {
  const transient = () =>
    new Error("screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot");

  test("retries a transient rejection once, whatever is taking the picture", async () => {
    const png = Buffer.from("png");
    let attempts = 0;
    const take = async () => {
      attempts += 1;
      if (attempts === 1) throw transient();
      return png;
    };

    expect(await retryTransientScreenshot(take)).toBe(png);
    expect(attempts).toBe(2);
  });

  test("lets a rejection that persists surface after one retry", async () => {
    let attempts = 0;
    const take = async () => {
      attempts += 1;
      throw transient();
    };

    await expect(retryTransientScreenshot(take)).rejects.toThrow("Unable to capture screenshot");
    expect(attempts).toBe(2);
  });
});
