import { confirm, isCancel } from "@clack/prompts";
import { BrowserMissingError, CHROMIUM_INSTALL_ARGV, CHROMIUM_INSTALL_CMD } from "@velloo/renderer";
import { fail } from "./fail.ts";

/**
 * Run a capture; if the headless browser is missing, offer to install it
 * (interactive shells only) and retry once. Non-interactive shells get the
 * actionable hint and a non-zero exit so CI fails loudly rather than hanging
 * on a prompt. Shared by `velloo render` and `velloo export` so both surface
 * the missing-Chromium hint identically.
 */
export async function captureWithBrowserSetup(
  cmd: string,
  capture: () => Promise<unknown>,
): Promise<void> {
  try {
    await capture();
    return;
  } catch (e) {
    if (!(e instanceof BrowserMissingError)) throw e;
    if (!process.stdin.isTTY) fail(cmd, e.message);
    const proceed = await confirm({
      message: `Chromium isn't installed. Run \`${CHROMIUM_INSTALL_CMD}\` now? (~150MB, one-time)`,
      initialValue: true,
    });
    if (isCancel(proceed) || !proceed) fail(cmd, e.message);
    const code = await Bun.spawn([...CHROMIUM_INSTALL_ARGV], {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }).exited;
    if (code !== 0) fail(cmd, "chromium install failed — see the output above.");
  }
  await capture();
}
