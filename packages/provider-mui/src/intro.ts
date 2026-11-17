/**
 * MCP framing for a MUI folder: `MUI_INTRO` is the brief's paragraph
 * (`FrameworkAdapter.mcpIntro`), `MUI_NOTES` what `list_components` hands over
 * with its index (`mcpNotes`).
 */
export const MUI_INTRO =
  '**This folder targets Material UI**: real `@mui/material`, `Typography` for ALL text. **Style through `sx`** (`{ p: 2, color: "primary.main" }`, spacing in theme units).';

export const MUI_NOTES: readonly string[] = [
  'Components are real MUI: `Box`/`Stack`/`Container`/`Paper` for layout, `Card`/`CardContent`/`CardHeader`/`CardActions`, `Typography` (pick `variant` for the type scale), `Button`/`IconButton`, `TextField`, `Chip`, `Divider`, `Avatar`, `List`/`ListItem`, `Table*`, `Tabs`/`Tab`, `Alert`, `Tooltip`, and the overlays `Dialog`/`Menu`/`Popover`/`Drawer`/`Snackbar` (rendered open and inline in design mode). `mode: "full"` gives per-component `example` props.',
  "`sx` is an object of MUI system props: it merges shallowly, an inner `null` drops a key, `style: null` clears. `emit_code` emits `<Component sx={{…}} />` importing from `@mui/material`; `emit_theme` emits a `createTheme(...)` module. Tailwind utility diagnostics do not apply — style via `sx` and the shared theme tokens from `get_theme`, which project onto MUI.",
];
