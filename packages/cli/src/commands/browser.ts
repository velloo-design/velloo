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
  if (code !== 0) fail("browser", `browser setup exited with status ${code}`);
}

export default defineCommand({
  meta: { name: "browser", description: "Install the optional browser used for screenshots" },
  args: {
    action: {
      type: "positional",
      required: false,
      default: "install",
      description: "Action (install)",
    },
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
    if (args.action !== "install")
      fail("browser", `unknown action "${args.action}"; expected install`);
    if (args["with-deps"] && process.platform === "linux") await run(CHROMIUM_DEPS_INSTALL_ARGV);
    await run(args.full ? CHROMIUM_FULL_INSTALL_ARGV : CHROMIUM_INSTALL_ARGV);
  },
});
