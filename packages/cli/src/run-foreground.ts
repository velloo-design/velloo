/**
 * Foreground attach for `velloo run`: stay in the terminal with single-key
 * shortcuts until the user backgrounds, stops, or the daemon exits.
 *
 * Keys are lowercase-only. Arrow-key CSI sequences can arrive split, and a
 * trailing `B` (down) must not mean "background".
 */

/** ETX — raw mode delivers Ctrl-C as a keystroke, not a signal. */
const CTRL_C = "\u0003";

export type RunKeyAction =
  | { kind: "background" }
  | { kind: "stop" }
  /** Open one canvas by 1-based position, or every one when `index` is absent. */
  | { kind: "open"; index?: number };

export type ForegroundOutcome = "background" | "stop" | "died";

/**
 * `targetCount` is how many canvases are attached: with one, `o` opens it;
 * with several, `1`–`9` open one each and `a` opens them all. A digit past
 * the end is ignored rather than opening the wrong canvas.
 */
export function actionForRunKey(key: string, targetCount = 1): RunKeyAction | null {
  if (key === "b") return { kind: "background" };
  if (key === "q" || key === CTRL_C) return { kind: "stop" };
  if (targetCount <= 1) return key === "o" ? { kind: "open" } : null;
  if (key === "a" || key === "o") return { kind: "open" };
  if (/^[1-9]$/.test(key)) {
    const index = Number(key);
    return index <= targetCount ? { kind: "open", index } : null;
  }
  return null;
}

export function shouldStayForeground(opts: { background: boolean; stdinIsTTY: boolean }): boolean {
  return !opts.background && opts.stdinIsTTY;
}

function bindRunKeys(onKey: (key: string) => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  const onData = (chunk: string): void => {
    onKey(chunk);
  };
  stdin.on("data", onData);
  return () => {
    stdin.off("data", onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}

const LIVE_POLL_MS = 2000;

/**
 * Block until the user backgrounds or stops, or a daemon disappears.
 * `onOpen` is the repeatable action (open a canvas) and does not settle; it
 * receives the 1-based target index, or undefined for "all".
 */
export async function waitInForeground(opts: {
  isLive: () => Promise<boolean>;
  onOpen: (index?: number) => void;
  /** Number of attached canvases; drives which keys are live. Default 1. */
  targetCount?: number;
}): Promise<ForegroundOutcome> {
  return await new Promise((resolve) => {
    let settled = false;
    let unbind = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (outcome: ForegroundOutcome) => {
      if (settled) return;
      settled = true;
      unbind();
      if (timer !== undefined) clearInterval(timer);
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      resolve(outcome);
    };
    const onStop = () => finish("stop");
    unbind = bindRunKeys((key) => {
      const action = actionForRunKey(key, opts.targetCount ?? 1);
      if (!action) return;
      if (action.kind === "open") opts.onOpen(action.index);
      else finish(action.kind);
    });
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
    timer = setInterval(() => {
      void opts.isLive().then((live) => {
        if (!live) finish("died");
      });
    }, LIVE_POLL_MS);
  });
}
