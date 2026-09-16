# @velloo/cli

The `velloo` binary. Citty-based.

## Subcommands

Commands are `velloo <verb>` for an action and `velloo <noun> <verb>` for
managing a set of things (`design list`, `publish remove`). A flag changes how a
command runs, never which one runs. A design is passed as a positional where it
is the command's subject (`velloo run web`) and as `--design` where the
positional is something else (`velloo emit <screen> --design=web`).

- **`velloo init [folder]`** — scaffold a new design folder in the app at `folder` (Elsewhere travel sample by default). Writes `.design/config.json`, `theme/default.json`, `screens/*.json`, `boards/*.json`, `snippets/*.json`.
- **`velloo design list|add|remove|move|rename|upgrade|bind|set-app-root`** — manage the repo's designs.
- **`velloo connect [design]`** — wire the user's AI agent: write its MCP config (`velloo mcp` over stdio) + the per-tool guidance (Claude skill / Cursor rule).
- **`velloo mcp [design]`** — the MCP server itself, spoken over stdio (the agent starts this; `--http` prints the daemon's HTTP MCP URL instead). Attaches to the design's canvas daemon, spawning one if needed.
- **`velloo run [design]`** — open the canvas for a design, spawning a persistent per-design daemon if none is running (prefers `:7300`, else a free port). Stays in the foreground on a TTY (`b` background, `s` stop, `o` open the browser); `--open` opens the browser immediately, `--background` returns to the shell. Canvas-only — the MCP server is separate (see `velloo mcp`).
- **`velloo stop [design]`** — stop the design's canvas daemon (it also auto-stops after 5 min idle).
- **`velloo emit [screen] --design`** — print the agent IR for one screen (or write to a file).
- **`velloo render [screen] --design`** — render a screen to HTML or PNG on stdout/disk.
- **`velloo export [target] --design`** — export a screen, frame or board as an image or HTML.
- **`velloo theme export --design --to`** — write DTCG `tokens.json` plus the framework-specific theme artifacts into a target app folder, with a diff against existing files.
- **`velloo capture [url] --design`** — open a browser to capture authenticated pages; `capture list` and `capture delete <id|all>` manage what's stored.
- **`velloo publish [design]`** — publish boards to a velloo-cloud share link; `publish list` and `publish remove [share-url]` manage what's published.
- **`velloo upgrade [design]`** — update the installation (npm, the standalone
  installer, or Homebrew) *and* migrate the designs to the current schema
  version. Outside a design folder it updates the installation alone; `--check`
  reports both without writing, and `--binary-only` / `--design-only` run one
  half — `velloo design upgrade [design]` is the design half on its own, for
  migrating one of several designs. Contributors: `bun run cli:build` records the build it just packed, and
  `velloo upgrade` then installs it over the global one.
- **`velloo browser install`** — install the optional headless browser used for screenshots.

## Layout

```
src/
  cli.ts                — citty entrypoint
  commands/             — one file per subcommand
  design-config.ts      — read .design/config.json with friendly errors
  scaffold/
    default-config.ts
    default-theme.ts
    sample-page.ts      — sample screens + boards
    sample-snippets.ts  — sample snippets
    elsewhere/              — canonical JSON for the welcome sample
```

The seven-screen Elsewhere sample, two boards, reusable snippets, local images and prompt metadata live as JSON under `scaffold/elsewhere/` so it can be iterated in the canvas and copied back. See `scaffold/elsewhere/README.md` for the iteration workflow.

## End-to-end test

`src/__tests__/init.test.ts` spawns `velloo init` into a tmp folder and parses every scaffolded file against the live schemas. If it fails, onboarding is broken.
