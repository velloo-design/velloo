import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import type { SpinnerResult } from "@clack/prompts";
import { createPublishReporter } from "../commands/publish.ts";
import { createProgress, type Progress } from "../progress.ts";

class CaptureOutput extends Writable {
  readonly chunks: string[] = [];
  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

function fakeSpinner(calls: string[]): SpinnerResult {
  return {
    start: (message = "") => calls.push(`start:${message}`),
    message: (message = "") => calls.push(`message:${message}`),
    stop: (message = "") => calls.push(`stop:${message}`),
    error: (message = "") => calls.push(`error:${message}`),
    cancel: (message = "") => calls.push(`cancel:${message}`),
    clear: () => calls.push("clear"),
    isCancelled: false,
  };
}

describe("createProgress", () => {
  test("updates one live spinner line in an interactive terminal", () => {
    const output = new CaptureOutput();
    const calls: string[] = [];
    const progress = createProgress({
      output,
      interactive: true,
      createSpinner: () => fakeSpinner(calls),
    });

    progress.start("capturing previews");
    progress.step("capturing previews 1/24", { transient: true });
    progress.step("capturing previews 24/24", { transient: true });
    progress.succeed("captured previews 24/24");

    expect(calls).toEqual([
      "start:capturing previews",
      "message:capturing previews 1/24",
      "message:capturing previews 24/24",
      "stop:captured previews 24/24",
    ]);
    expect(output.text()).toBe("");
  });

  test("keeps non-TTY output line-based and suppresses transient ticks", () => {
    const output = new CaptureOutput();
    const progress = createProgress({ output, interactive: false });

    progress.start("collecting boards");
    progress.step("capturing previews");
    progress.step("capturing previews 1/24", { transient: true });
    progress.step("capturing previews 24/24", { transient: true });
    progress.step("capturing previews 24/24");
    progress.step("uploading 8 files");
    progress.succeed("published design");

    expect(output.text()).toBe(
      [
        "  collecting boards",
        "  capturing previews",
        "  capturing previews 24/24",
        "  uploading 8 files",
        "  published design",
        "",
      ].join("\n"),
    );
    expect(output.text()).not.toContain("1/24");
  });

  test("is completely silent when a command owns machine-readable output", () => {
    const output = new CaptureOutput();
    let spinnerCreated = false;
    const progress = createProgress({
      output,
      interactive: true,
      silent: true,
      createSpinner: () => {
        spinnerCreated = true;
        return fakeSpinner([]);
      },
    });

    progress.start("working");
    progress.step("still working");
    progress.log("a warning");
    progress.fail("failed");

    expect(output.text()).toBe("");
    expect(spinnerCreated).toBe(false);
  });

  test("temporarily clears a live spinner when logging an advisory", () => {
    const output = new CaptureOutput();
    const calls: string[] = [];
    const progress = createProgress({
      output,
      interactive: true,
      createSpinner: () => fakeSpinner(calls),
    });

    progress.start("bundling components");
    progress.log("asset not found: logo.png");
    progress.step("uploading files");
    progress.succeed("published design");

    expect(calls).toEqual([
      "start:bundling components",
      "clear",
      "start:bundling components",
      "message:uploading files",
      "stop:published design",
    ]);
    expect(output.text()).toBe("  asset not found: logo.png\n");
  });
});

test("publish reports capture ticks transiently and persists only the final count", () => {
  const calls: string[] = [];
  const progress: Progress = {
    start: (message) => calls.push(`start:${message}`),
    step: (message, options) =>
      calls.push(`step:${message}${options?.transient ? ":transient" : ""}`),
    succeed: (message) => calls.push(`succeed:${message}`),
    fail: (message) => calls.push(`fail:${message}`),
    log: (message) => calls.push(`log:${message}`),
  };
  const report = createPublishReporter(progress);

  report({ kind: "step", step: "capture", message: "capturing previews" });
  report({ kind: "capture", done: 1, total: 24 });
  report({ kind: "capture", done: 24, total: 24 });
  report({ kind: "step", step: "upload", message: "uploading 28 files (2.1 MB)" });

  expect(calls).toEqual([
    "step:capturing previews",
    "step:capturing previews 1/24:transient",
    "step:capturing previews 24/24:transient",
    "step:capturing previews 24/24",
    "step:uploading 28 files (2.1 MB)",
  ]);
});
