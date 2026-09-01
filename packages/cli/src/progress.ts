import { stderr } from "node:process";
import type { Writable } from "node:stream";
import { type SpinnerResult, spinner } from "@clack/prompts";

export interface ProgressStepOptions {
  /** Update a live spinner, but do not emit a separate line in CI or a pipe. */
  transient?: boolean;
}

export interface Progress {
  start(message: string): void;
  step(message: string, options?: ProgressStepOptions): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  /** Print an advisory without losing the operation currently being shown. */
  log(message: string): void;
}

interface ProgressOutput extends Writable {
  isTTY?: boolean;
}

interface ProgressOptions {
  /** Suppress every progress write, for commands whose output is machine-readable. */
  silent?: boolean;
  output?: ProgressOutput;
  /** Override terminal detection. Primarily useful to exercise both modes in tests. */
  interactive?: boolean;
  createSpinner?: (output: Writable) => SpinnerResult;
}

/**
 * Shared long-operation output for CLI commands.
 *
 * A terminal gets one animated Clack line whose text changes in place. Pipes
 * and CI get stable, newline-delimited stage boundaries; high-frequency
 * transient updates (for example 17/24 screenshots) stay on the terminal line
 * instead of flooding logs. Progress belongs on stderr so stdout can remain a
 * command's payload (JSX, JSON, or a URL).
 */
export function createProgress(options: ProgressOptions = {}): Progress {
  const output = options.output ?? stderr;
  const silent = options.silent === true;
  const interactive =
    options.interactive ?? (Boolean(output.isTTY) && process.env.CI === undefined);
  const makeSpinner =
    options.createSpinner ??
    ((stream: Writable) => spinner({ output: stream, indicator: "dots", withGuide: false }));

  let active = false;
  let current = "";
  let lastPrinted = "";
  let live: SpinnerResult | null = null;

  const writeLine = (message: string): void => {
    if (!message || message === lastPrinted) return;
    output.write(`  ${message}\n`);
    lastPrinted = message;
  };

  const begin = (message: string): void => {
    active = true;
    current = message;
    if (silent) return;
    if (interactive) {
      live = makeSpinner(output);
      live.start(message);
    } else {
      writeLine(message);
    }
  };

  return {
    start(message) {
      if (active) {
        this.step(message);
        return;
      }
      begin(message);
    },

    step(message, stepOptions = {}) {
      if (!active) {
        begin(message);
        return;
      }
      current = message;
      if (silent) return;
      if (interactive) live?.message(message);
      else if (!stepOptions.transient) writeLine(message);
    },

    succeed(message = current) {
      if (!active) return;
      active = false;
      current = message;
      if (silent) return;
      if (interactive) live?.stop(message);
      else writeLine(message);
      live = null;
    },

    fail(message = current) {
      if (!active) return;
      active = false;
      current = message;
      if (silent) return;
      if (interactive) live?.error(message);
      else writeLine(message);
      live = null;
    },

    log(message) {
      if (silent) return;
      if (interactive && active) {
        live?.clear();
        writeLine(message);
        live = makeSpinner(output);
        live.start(current);
        return;
      }
      writeLine(message);
    },
  };
}
