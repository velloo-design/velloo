#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { COMMANDS } from "./commands/registry.ts";
import { maybeNotifyAboutUpdate } from "./update.ts";
import { TOOL_VERSION } from "./version.ts";

const main = defineCommand({
  meta: {
    name: "velloo",
    version: TOOL_VERSION,
    description:
      "Local, agent-driven canvas for designing React apps, verifying the implementation, and sharing the result with a team or external reviewers.",
  },
  subCommands: COMMANDS,
});

await runMain(main);

const command = process.argv[2];
if (!["mcp", "__daemon", "__update_check", "run"].includes(command ?? "")) {
  await maybeNotifyAboutUpdate();
}
