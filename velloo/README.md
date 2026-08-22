# Velloo design folder

This folder is a Velloo design — pure JSON describing screens,
boards, snippets, and a theme. Velloo renders these with real
React components from a pinned **shadcn (2026.05.22)** snapshot.

## Quick start

```bash
velloo run .
```

`velloo run .` prints and opens the canvas URL — it defaults to
http://localhost:7300, but uses a free port if that's taken. Your AI
agent drives the design over MCP — wire it once with `velloo connect`,
and it starts the velloo MCP server itself (no separate server to run).

## Your setup

| | |
|---|---|
| Library | shadcn (2026.05.22) |
| Components | bundled with velloo |
| App root | .. |
| Initial content | scanned from your app |

## Layout

```
.design/config.json        tool + library declaration
theme/default.json         color tokens (OKLCH)
screens/<id>.json          one composition each (light + dark)
boards/<id>.json           frame layouts on the canvas
snippets/<id>.json         reusable subtrees with typed params
assets/                    generated SVGs / images
```

## Bundled components

The shadcn snapshot lives inside the velloo binary. No files were
written to your app. When you're ready to bring shadcn into your
project, run `npx shadcn@latest init` there separately, then
`velloo theme:export <app>` to align the theme.

## What the AI agent sees

Velloo exposes ~55 MCP tools — discovery (`list_screens`, `list_components`,
`list_snippets`, `get_theme`), tree mutations (`add_node`, `update_props`,
`apply_classes`, `move_node`, …), snippets, theme operations (`set_token`,
`apply_preset`, `derive_palette_from_color`), inspection
(`inspect`, `inspect_dark_diff`, `screenshot`, `validate_classes`), and
code emission (`emit_code`, `emit_snippet`, `emit_theme`).

Designs are static by construction — click handlers, routing, and forms
are no-ops in the canvas. The agent reads the design and writes real
code into your app via `emit_code`.
