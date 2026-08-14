# @velloo/codegen

What the agent uses to turn a Velloo design into real code in the user's app.

- **`emitCode(screen, options)`** — agent-consumed IR for a screen. Returns `{ screen, jsx, componentsUsed, iconsUsed, snippetsUsed, classesUsed }`. No imports, no prettier — the agent decides on import paths + formatting to match the host app's conventions.
- **`emitSnippet(snippet, options)`** — equivalent IR for a snippet body, plus the param signature for the agent to construct a typed React component.
- **`emitTheme(theme, opts)`** — writes Tailwind v4 `globals.css` + `tailwind.config.ts`. Returns `{ files: [{ path, content, diff }] }` so the CLI can show a diff before applying. Uses `diff.ts` + `colorizeDiff.ts` for the CLI's `velloo theme export` command.

The split: emit-code produces IR for agents (no formatting), emit-theme produces real on-disk files for the user.

Imports `@velloo/schema` + `@velloo/result`.
