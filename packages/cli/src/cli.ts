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
      "Local, agent-driven canvas for redesigning an existing React screen against the running app, then sharing the result with a team or external reviewer.",
  },
  subCommands: COMMANDS,
});

await runMain(main);

// Every command that returns to a prompt gets the notice. `mcp` and `__daemon`
// own their stdio (one speaks a protocol on it, the other is detached);
// interactive `run` doesn't return until the user quits the canvas session, so
// the notice would land after they're already done — the canvas itself carries
// the news there; and `upgrade` is the thing being suggested.
const command = process.argv[2];
if (!["mcp", "__daemon", "__update_check", "run", "upgrade"].includes(command ?? "")) {
  await maybeNotifyAboutUpdate();
}
