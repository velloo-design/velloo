# @velloo/cli

The `velloo` binary. Citty-based.

## Subcommands

- **`velloo init <folder>`** — scaffold a new design folder (Pulse sample by default). Writes `.design/config.json`, `theme/default.json`, `screens/*.json`, `boards/*.json`, `snippets/*.json`.
- **`velloo run <folder>`** — start the canvas at `:7300` + MCP at `:7301`. Loads the folder, starts the watcher.
- **`velloo emit <folder>`** — print the agent IR for one screen (or write to a file).
- **`velloo render <folder>`** — render a screen to HTML or PNG on stdout/disk.
- **`velloo theme export <folder>`** — write `globals.css` + `tailwind.config.ts` into a target app folder, with a diff against existing files.
- **`velloo upgrade <folder>`** — upgrade a design folder to the current schema version.

## Layout

```
src/
  cli.ts                — citty entrypoint
  commands/             — one file per subcommand
  design-config.ts      — read .design/config.json with friendly errors
  scaffold/
    default-config.ts
    default-theme.ts
    sample-page.ts      — sample screens + boards (Pulse)
    sample-snippets.ts  — sample snippets
    pulse/              — canonical JSON for the Pulse sample
```

The Pulse sample lives as JSON under `scaffold/pulse/` so it can be iterated in the canvas and copied back. See `scaffold/pulse/README.md` for the iteration workflow.

## End-to-end test

`src/__tests__/init.test.ts` spawns `velloo init` into a tmp folder and parses every scaffolded file against the live schemas. If it fails, onboarding is broken.
