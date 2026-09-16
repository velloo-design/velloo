import { describe, expect, spyOn, test } from "bun:test";
import { defineCommand, runCommand } from "citty";
import { strictFlags } from "../strict-flags.ts";

const command = defineCommand({
  meta: { name: "run" },
  args: {
    folder: { type: "positional", required: false },
    port: { type: "string" },
    mcpUrl: { type: "string" },
    open: { type: "boolean", default: true },
    verbose: { type: "boolean", alias: "V" },
  },
  run: () => {},
});

async function exitOf(rawArgs: string[]): Promise<{ code: number | null; message: string }> {
  const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`exit ${code}`);
  }) as typeof process.exit);
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    await runCommand(strictFlags("run", command), { rawArgs });
    return { code: null, message: "" };
  } catch {
    return { code: 1, message: error.mock.calls.flat().join(" ") };
  } finally {
    exit.mockRestore();
    error.mockRestore();
  }
}

describe("strictFlags", () => {
  test.each([
    [["design", "--port", "7300"]],
    [["--port=7300", "--mcp-url", "http://x"]],
    [["--mcpUrl", "http://x"]],
    [["--no-open"]],
    [["-V"]],
    [["--help"]],
    [["--", "--anything-after-the-terminator"]],
    [["--port", "-1"]],
  ])("accepts %j", async (rawArgs) => {
    expect((await exitOf(rawArgs)).code).toBeNull();
  });

  test("rejects a flag the command doesn't declare, and lists the ones it does", async () => {
    const result = await exitOf(["design", "--mcp-port", "7999"]);
    expect(result.code).toBe(1);
    expect(result.message).toContain("unknown option --mcp-port");
    expect(result.message).toContain("--port");
  });

  test("rejects an unknown short flag", async () => {
    expect((await exitOf(["-x"])).message).toContain("unknown option -x");
  });

  test("checks a subcommand against its own flags", async () => {
    const parent = defineCommand({
      meta: { name: "design" },
      subCommands: { list: defineCommand({ args: { json: { type: "boolean" } }, run: () => {} }) },
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit);
    try {
      await runCommand(strictFlags("design", parent), { rawArgs: ["list", "--json"] });
      await expect(
        runCommand(strictFlags("design", parent), { rawArgs: ["list", "--jsn"] }),
      ).rejects.toThrow("exit 1");
      expect(error.mock.calls.flat().join(" ")).toContain("velloo design list:");
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
