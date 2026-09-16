import {
  CHROMIUM_DEPS_INSTALL_ARGV,
  CHROMIUM_FULL_INSTALL_ARGV,
  CHROMIUM_INSTALL_ARGV,
} from "@velloo/renderer";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";

async function run(argv: readonly string[]): Promise<void> {
  const code = await Bun.spawn([...argv], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (code !== 0) fail("browser install", `browser setup exited with status ${code}`);
}

const install = defineCommand({
  meta: { name: "install", description: "Install the browser used for screenshots" },
  args: {
    full: {
      type: "boolean",
      default: false,
      description: "Install full Chromium instead of the smaller headless shell",
    },
    "with-deps": {
      type: "boolean",
      default: false,
      description: "Also install required Linux system packages (may use sudo)",
    },
  },
  async run({ args }) {
    if (args["with-deps"] && process.platform === "linux") await run(CHROMIUM_DEPS_INSTALL_ARGV);
    await run(args.full ? CHROMIUM_FULL_INSTALL_ARGV : CHROMIUM_INSTALL_ARGV);
  },
});

export default defineCommand({
  meta: { name: "browser", description: "Manage the optional browser used for screenshots" },
  subCommands: { install },
});
