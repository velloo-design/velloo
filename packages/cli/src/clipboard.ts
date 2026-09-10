/** Best-effort clipboard write via the platform's native CLI. */
export async function copyToClipboard(text: string): Promise<boolean> {
  const candidates: string[][] =
    process.platform === "darwin"
      ? [["pbcopy"]]
      : process.platform === "win32"
        ? [["clip"]]
        : [["wl-copy"], ["xclip", "-selection", "clipboard"], ["xsel", "--clipboard", "--input"]];
  for (const argv of candidates) {
    const bin = argv[0];
    if (!bin || !Bun.which(bin)) continue;
    const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    proc.stdin.write(text);
    await proc.stdin.end();
    if ((await proc.exited) === 0) return true;
  }
  return false;
}
