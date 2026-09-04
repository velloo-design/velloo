/**
 * MCP instruction framing for a MUI folder (`FrameworkAdapter.mcpIntro`).
 *
 * The server's base brief is framework-neutral, so this states the vocabulary
 * and the style channel positively rather than correcting a shadcn claim.
 */
export const MUI_INTRO: readonly string[] = [
  "**This folder targets Material UI.** Components are real MUI: `Box`/`Stack`/`Container`/`Paper` for layout, `Card`/`CardContent`/`CardHeader`/`CardActions`, `Typography` (ALL text — pick `variant` for the type scale), `Button`/`IconButton`, `TextField`, `Chip`, `Divider`, `Avatar`, `List`/`ListItem`, `Table*`, `Tabs`/`Tab`, `Alert`, `Tooltip`, and the overlay surface `Dialog`/`Menu`/`Popover`/`Drawer`/`Snackbar` (rendered open + inline in design mode). Call `list_components` for the full set and per-component `example` props.",
  "",
  '**Style through `sx`.** `update_props { style: { display: "flex", alignItems: "center", gap: 2, p: 3, color: "primary.main" } }` — an object of MUI system props, where spacing is theme units (`p: 2` = 16px). It merges shallowly; an inner `null` drops a key, `style: null` clears. `emit_code` emits `<Component sx={{…}} />` importing from `@mui/material`; `emit_theme` emits a `createTheme(...)` module. Tailwind utility classes and the `audit` tool do not apply here — style via `sx` plus the shared theme tokens from `get_theme`, which project onto MUI.',
  "",
];
