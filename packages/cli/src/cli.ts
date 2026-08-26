#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { COMMANDS } from "./commands/registry.ts";
import { TOOL_VERSION } from "./version.ts";

const main = defineCommand({
  meta: {
    name: "velloo",
    version: TOOL_VERSION,
    description: "Code-shaped design tool for developers",
  },
  subCommands: COMMANDS,
});

runMain(main);
