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
      "Code-shaped design tool for developers. A repo-root velloo.json names design folders as projects; any directory with .design/config.json is a design folder — folder-taking commands accept a project name or a path.",
  },
  subCommands: COMMANDS,
});

await runMain(main);

const command = process.argv[2];
if (!["mcp", "__daemon", "__update_check", "ci", "run"].includes(command ?? "")) {
  await maybeNotifyAboutUpdate();
}
