# Velloo's own design folder

Velloo designs itself here: explorations for the canvas chrome — header, side
panes, search, settings, the node HUD, the typography panel, board organization,
render errors. Its host app is `packages/canvas` (`hostApp.root` in
`.design/config.json`), so frames render the chrome's real shadcn components.

```bash
velloo run          # from the repo root — starts only this folder
```

The framework demos live in `../demo-boards/` and have their own `velloo.json`;
run `velloo run` there to open them.

## Layout

```
.design/config.json        tool + library declaration, board order and groups
theme/<name>.json          token sets (OKLCH) — boards pick one
screens/<id>.json          one composition each (light + dark)
boards/<id>.json           frame layouts on the canvas (+ <id>.notes.json)
snippets/<id>.json         reusable subtrees with typed params
assets/, assets.json       images and their generation metadata
```

The folder is tool-owned: change it through the canvas or an agent over MCP,
not by editing the JSON by hand.
