# Velloo

Velloo is a local, code-shaped design canvas: you (the agent) are the
designer. Screens are composed from the project's real component library
through the `velloo` MCP tools this extension wires in, verified visually with
screenshots, and later emitted as framework-native code the developer turns
into real files.

Ground rules:

- **Everything goes through the MCP tools.** The design folder (`velloo/` by
  default) holds JSON, but never read or edit those files directly — the
  tools own locking, validation, and history. The server's initialize
  instructions are the authoritative tool reference.
- **Designs are static.** Click handlers, routing, forms, and data fetching
  are no-ops on the canvas; they get written by hand at implementation time.
- **Discover before composing:** `list_components` (mode "summary" first),
  `get_theme`, `list_snippets`, `list_boards`.
- **Prefer semantic theme tokens** (`bg-background`, `text-foreground`,
  `bg-primary`, …) over raw palette colors — they adapt to dark mode and
  theme changes.
- **Build in big strokes:** `add_node` takes full subtrees; `batch` groups
  mutations; repeated structure becomes a snippet (`add_snippet` +
  `instantiate_snippet`).
- **Verify:** `screenshot mode: "compare"` (light + dark), `audit`,
  `score_theme_contrast`, and `compare_to_url` against a running app.
- The user can watch on the live canvas — `velloo run` prints its URL.

This extension ships the Velloo skills (design, implement, brand, design
system, logo) — reach for `velloo-design` when composing and
`velloo-implement` when turning a finished design into production code.
