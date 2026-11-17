/**
 * MCP framing for an antd folder: `ANTD_INTRO` is the brief's paragraph
 * (`FrameworkAdapter.mcpIntro`), `ANTD_NOTES` what `list_components` hands
 * over with its index (`mcpNotes`).
 */
export const ANTD_INTRO =
  "**This folder targets Ant Design v5**: real antd, `TypographyTitle`/`TypographyText` for ALL text. **Style through the inline `style` object**; tokens are CSS variables (`var(--ant-color-primary)`).";

export const ANTD_NOTES: readonly string[] = [
  "Components are real antd: `Flex`/`Space`/`Row`+`Col` for layout, `Card`, `TypographyTitle`/`TypographyText`/`TypographyParagraph` (antd's `Typography.Title/Text/Paragraph` under flat ids, since a `$ref` can't carry a dot; they emit as the dotted exports), `Button`, `Input`/`Select`/`Checkbox`/`Radio`/`Switch`/`Segmented`/`Slider`/`Rate`, `Tag`/`Badge`/`Avatar`/`Alert`/`Statistic`/`Progress`/`Skeleton`/`Empty`, `Table`/`List`+`ListItem`/`Tabs`/`Steps`/`Breadcrumb`/`Pagination`/`Menu` (data components take `items`/`columns` arrays — no render functions), and the overlays `Modal`/`Drawer`/`Popover`/`Tooltip`/`Dropdown` (rendered open and inline in design mode). `mode: \"full\"` gives per-component `example` props.",
  '`update_props { style: { display: "flex", alignItems: "center", gap: "16px" } }` takes a plain React style object: it merges shallowly, an inner `null` drops a key, `style: null` clears. Inside an antd subtree, `var(--ant-color-primary)`, `var(--ant-color-text-secondary)`, `var(--ant-color-bg-container)`, `var(--ant-border-radius)` keep it themable; plain CSS values always work. Prefer component props (`type`, `size`, `gap`) over style overrides. A plain `<div>`/`<span>` composes as `Box` and emits as the bare element.',
  "`emit_code` emits antd JSX with `style={{…}}` against the real exports (`<Typography.Title>`, `<List.Item.Meta>`), and `packagesToImport` names their package. `emit_theme` emits a ConfigProvider `ThemeConfig` module (default `antd-theme.ts`) — wire it with `<ConfigProvider theme={theme}>`. Tailwind utility diagnostics do not apply.",
];
