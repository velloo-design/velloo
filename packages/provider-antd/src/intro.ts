/**
 * MCP instruction framing for an antd folder (`FrameworkAdapter.mcpIntro`).
 *
 * The server's base brief is framework-neutral, so this states the vocabulary
 * and the style channel positively rather than correcting a shadcn claim.
 */
export const ANTD_INTRO: readonly string[] = [
  "**This folder targets Ant Design v5.** Components are real antd: `Flex`/`Space`/`Row`+`Col` for layout, `Card`, `TypographyTitle`/`TypographyText`/`TypographyParagraph` (ALL text — these are antd's `Typography.Title/Text/Paragraph` under flat ids), `Button`, `Input`/`Select`/`Checkbox`/`Radio`/`Switch`/`Segmented`/`Slider`/`Rate`, `Tag`/`Badge`/`Avatar`/`Alert`/`Statistic`/`Progress`/`Skeleton`/`Empty`, `Table`/`List`+`ListItem`/`Tabs`/`Steps`/`Breadcrumb`/`Pagination`/`Menu` (data components take `items`/`columns` arrays — no render functions), and the overlay surface `Modal`/`Drawer`/`Popover`/`Tooltip`/`Dropdown` (rendered open + inline in design mode). Call `list_components` for the full set and per-component `example` props.",
  "",
  '**Style through the inline `style` object.** `update_props { style: { display: "flex", alignItems: "center", gap: "16px", padding: "24px" } }` — a plain React style object (merges shallowly; an inner `null` drops a key, `style: null` clears). The theme runs in antd\'s `cssVar` mode, so antd tokens are CSS variables: inside any antd component subtree you can reference `var(--ant-color-primary)`, `var(--ant-color-text-secondary)`, `var(--ant-color-bg-container)`, `var(--ant-border-radius)` etc. to stay themable; plain CSS values always work. Prefer component props (`type`, `size`, `gap`) over style overrides where they exist.',
  "",
  '`emit_code` emits idiomatic antd JSX with `style={{…}}` — components import from `"antd"`. The flat typography/list ids map to dotted antd exports: destructure them when writing real code (`const { Title: TypographyTitle, Text: TypographyText, Paragraph: TypographyParagraph } = Typography;` and `const ListItem = List.Item; const ListItemMeta = List.Item.Meta;`) or rename the JSX tags to the dotted form. `emit_theme` emits a ConfigProvider `ThemeConfig` module (default `antd-theme.ts`) — wire it with `<ConfigProvider theme={theme}>`. Tailwind utility classes and the `audit` tool do not apply here.',
  "",
];
