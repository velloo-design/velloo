# @velloo/codegen

What the agent uses to turn a Velloo design into real code in the user's app.

- **`emitCode(screen, options)`** — agent-consumed IR for a screen. Returns `{ screen, jsx, componentsUsed, iconsUsed, snippetsUsed, classesUsed }`. No imports, no prettier — the agent decides on import paths + formatting to match the host app's conventions.
- **`emitSnippet(snippet, options)`** — equivalent IR for a snippet body, plus the param signature for the agent to construct a typed React component.
- **`emitTheme(theme, opts)`** — writes framework-neutral DTCG `tokens.json` alongside Tailwind v4 `globals.css` + `tailwind.config.ts`. Returns `{ files: [{ path, content, diff }] }` so the CLI can show a diff before applying. Uses `diff.ts` + `colorizeDiff.ts` for the CLI's `velloo theme export` command.

The split: emit-code produces IR for agents, emit-theme produces real on-disk files for the user.

**Nothing here formats.** Velloo ships no formatter and imposes no config: most
people don't use biome, and the ones who do have their own version and rules.
emit-code hands the agent an IR that it writes in the host app's conventions,
running whatever formatter that app already uses; emit-theme writes CSS the
emitters lay out readably themselves. If you add an emitter, indent and space
its output rather than reaching for a formatting pass.

Imports `@velloo/schema` + `@velloo/result`.
