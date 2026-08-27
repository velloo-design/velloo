/**
 * MCP instruction framing for a MUI folder (`FrameworkAdapter.mcpIntro`).
 * The server's base instruction text is shadcn/Tailwind-tuned; this prefix
 * frames the agent for Material UI first and tells it which of that guidance
 * to ignore.
 */
export const MUI_INTRO: readonly string[] = [
  "You are working on a **Material UI** Velloo design folder. Components are real MUI: `Box`/`Stack`/`Container`/`Paper` for layout, `Card`/`CardContent`/`CardHeader`/`CardActions`, `Typography` (ALL text — pick `variant` for the type scale; this is MUI's Heading+Text), `Button`/`IconButton`, `TextField`, `Chip`, `Divider`, `Avatar`, `List`/`ListItem`, `Table*`, `Tabs`/`Tab`, `Alert`, `Tooltip`, and the overlay surface `Dialog`/`Menu`/`Popover`/`Drawer`/`Snackbar` (rendered open + inline in design mode). Call `list_components` for the full set + per-component `example` props, and `get_theme` for the tokens. Designs are static — handlers/routing/forms are no-op.",
  "",
  '**Style with the `sx` object, not Tailwind classes.** Use `set_style { style: { display: "flex", alignItems: "center", gap: 2, p: 3, color: "primary.main" } }` — an object (merges shallowly; an inner `null` drops a key; `style: null` clears). `sx` keys are MUI system props; spacing is theme units (`p: 2` = 16px). `emit_code` emits idiomatic `<Component sx={{…}} />` importing from `@mui/material`; `emit_theme` emits a `createTheme(...)` module. **The Tailwind-specific guidance in the rest of these instructions — `className`, semantic utility tokens (`bg-background`, `text-muted-foreground`) and the `audit` tool — is for shadcn folders and does NOT apply here.** Style via `sx` + the shared theme tokens (`get_theme`); the same abstract palette/spacing/radius/typography projects onto MUI.',
  "",
];
