/**
 * Spawn a process that outlives this one and everything that happens to it.
 * The daemon is shared by every agent on the folder, so it must not share the
 * fate of whichever CLI spawned it:
 *
 * - Windows puts an attached child in the parent's job object, which is killed
 *   when the parent exits — `velloo run --background` would take its canvas
 *   down with it.
 * - On POSIX an attached child is in the parent's process group, and a
 *   terminal's Ctrl-C or hangup reaches the whole foreground group: stopping
 *   one agent in its terminal would stop the canvas under every other agent
 *   and browser tab on the folder.
 *
 * Its own session (`detached`) avoids both. It still ends on its own — the
 * daemon stops after five idle minutes, or on `velloo stop`.
 */
export function spawnOutliving(cmd: string[], output: number | "ignore"): Bun.Subprocess {
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: output,
    stderr: output,
    detached: true,
    windowsHide: true,
  });
  // Let this process exit without waiting for — or killing — the child.
  proc.unref();
  return proc;
}
