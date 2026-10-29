import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { JsonLineProcess } from "../agent/process.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.skipIf(process.platform === "win32")(
  "closing an agent's process also stops what it started",
  async () => {
    let child = 0;
    const proc = new JsonLineProcess(
      [
        process.execPath,
        "-e",
        `const c = Bun.spawn(["sleep", "30"]); console.log(JSON.stringify({ child: c.pid })); await new Promise(() => {});`,
      ],
      tmpdir(),
      {
        message: (value) => {
          if (value && typeof value === "object" && "child" in value) child = Number(value.child);
        },
        malformed: () => undefined,
        exit: () => undefined,
      },
    );
    const end = Date.now() + 5_000;
    while (!child && Date.now() < end) await Bun.sleep(20);
    expect(alive(child)).toBe(true);
    await proc.close();
    const gone = Date.now() + 2_000;
    while (alive(child) && Date.now() < gone) await Bun.sleep(20);
    expect(alive(child)).toBe(false);
  },
);
