# pulse — sample design shipped by `velloo init`

This folder is the canonical source for the sample design `velloo init` writes
into a fresh folder. It's a fictional team-analytics product called "Pulse",
chosen because it shows off the canvas at its best:

- **Two boards**: `marketing` (landing, pricing, signup) and `app`
  (dashboard, insights, settings). Six screens total.
- **Multi-frame landing**: the landing screen renders in two frames — desktop
  (1440×) and mobile (390×) — to demonstrate that frames sharing a screen
  always sync.
- **Three snippets**: `stat-card`, `feature-row`, `sidebar-nav-row`. The
  dashboard's stat tiles, the landing's features, and every sidebar nav row
  reuse these.
- **Indigo accent + cohesive dark mode**: every color uses semantic tokens
  (`bg-primary`, `text-muted-foreground`, …). 100% dark-diff coverage.

## Iterating on the sample

The sample is designed to be edited inside the canvas itself, not by hand.

1. `velloo run <a-temp-folder>` against a folder scaffolded from this sample.
2. Edit in the canvas — the AI agent has full Velloo MCP if you'd rather
   drive changes that way.
3. When happy, copy the resulting JSON back into this folder:

   ```bash
   cp /tmp/velloo-demo/boards/*.json packages/cli/src/scaffold/pulse/boards/
   cp /tmp/velloo-demo/screens/*.json packages/cli/src/scaffold/pulse/screens/
   cp /tmp/velloo-demo/snippets/*.json packages/cli/src/scaffold/pulse/snippets/
   cp /tmp/velloo-demo/theme/default.json packages/cli/src/scaffold/pulse/theme/default.json
   ```

4. Verify with `rm -rf /tmp/new && bun run velloo init /tmp/new` — fresh
   scaffold should match what you saw in the canvas.

## Why JSON, not TypeScript

Earlier iterations of this folder were 600+ lines of hand-written TypeScript
builders. That made small tweaks expensive — every padding or copy change
needed a code edit. Storing the design as canonical JSON means the canvas's
own MCP edits flow directly into the scaffold.

The TypeScript files in the parent directory (`sample-page.ts`,
`sample-snippets.ts`, `default-theme.ts`) just import + return these JSON
files; they're thin shims over the data.
