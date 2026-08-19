/**
 * Open a URL in the user's default browser. Best-effort: a missing opener
 * (headless box, CI, locked-down container) is swallowed — the caller has
 * already printed the URL, so this is a convenience, never a hard dependency.
 */
export async function openUrl(url: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).exited;
  } catch {
    // No opener available — the URL is already on screen.
  }
}
