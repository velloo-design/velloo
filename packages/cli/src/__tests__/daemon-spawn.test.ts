import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The canvas daemon must outlive the CLI that spawned it — on Windows, where an
 * attached child dies with its parent's job object, and on POSIX, where a
 * terminal's Ctrl-C reaches the spawner's whole process group. Each case runs
 * a real spawner process so the platform's own process model is what's tested.
 */

const runtime = resolve(import.meta.dir, "../daemon/runtime.ts");
const children: number[] = [];
let dir: string | undefined;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function eventually(check: () => boolean, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await Bun.sleep(100);
  }
  return check();
}

/** A spawner that starts a long-lived child through `spawnOutliving`, prints its pid, then `after`s. */
async function spawner(
  after: "exit" | "wait",
): Promise<{ proc: Bun.Subprocess<"ignore", "pipe">; child: number }> {
  dir = await mkdtemp(join(tmpdir(), "velloo-spawn-"));
  const script = join(dir, "spawner.ts");
  await writeFile(
    script,
    `import { spawnOutliving } from ${JSON.stringify(runtime)};
const child = spawnOutliving([process.execPath, "-e", "setInterval(() => {}, 1000)"], "ignore");
console.log(child.pid);
${after === "exit" ? "process.exit(0);" : "setInterval(() => {}, 1000);"}
`,
  );
  // Its own group on POSIX, so signalling that group below can't reach the test runner.
  const proc = Bun.spawn([process.execPath, script], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    detached: process.platform !== "win32",
  });
  const reader = proc.stdout.getReader();
  let text = "";
  while (!/\n/.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  const child = Number.parseInt(text.trim(), 10);
  children.push(child);
  return { proc, child };
}

afterEach(async () => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("spawnOutliving", () => {
  test("the child keeps running after the spawner exits", async () => {
    const { proc, child } = await spawner("exit");
    await proc.exited;
    // Windows tears a job object down just after its owner exits; give it the chance.
    await Bun.sleep(500);
    expect(alive(child)).toBe(true);
  }, 20_000);

  test.skipIf(process.platform === "win32")(
    "a Ctrl-C to the spawner's process group doesn't reach the child",
    async () => {
      const { proc, child } = await spawner("wait");
      const pid = proc.pid;
      // What a terminal does on Ctrl-C: SIGINT to the whole foreground group.
      process.kill(-pid, "SIGINT");
      await proc.exited;
      expect(await eventually(() => !alive(pid))).toBe(true);
      await Bun.sleep(300);
      expect(alive(child)).toBe(true);
    },
    20_000,
  );

  test.skipIf(process.platform !== "win32")(
    "the child survives the spawner being killed outright",
    async () => {
      const { proc, child } = await spawner("wait");
      // What closing the terminal or ending the agent's task does on Windows.
      proc.kill();
      await proc.exited;
      await Bun.sleep(500);
      expect(alive(child)).toBe(true);
    },
    20_000,
  );
});
