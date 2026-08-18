#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { TOOL_VERSION } from "./version.ts";

const main = defineCommand({
  meta: {
    name: "velloo",
    version: TOOL_VERSION,
    description: "Code-shaped design tool for shadcn devs",
  },
  subCommands: {
    init: () => import("./commands/init.ts").then((m) => m.default),
    login: () => import("./commands/login.ts").then((m) => m.default),
    connect: () => import("./commands/connect.ts").then((m) => m.default),
    run: () => import("./commands/run.ts").then((m) => m.default),
    render: () => import("./commands/render.ts").then((m) => m.default),
    publish: () => import("./commands/publish.ts").then((m) => m.default),
    emit: () => import("./commands/emit.ts").then((m) => m.default),
    "theme:export": () => import("./commands/theme-export.ts").then((m) => m.default),
  },
});

runMain(main);
