/**
 * MCP instruction framing for a chakra folder (`FrameworkAdapter.mcpIntro`).
 * The server's base instruction text is shadcn/Tailwind-tuned; this prefix
 * frames the agent for Chakra UI first and tells it which of that guidance
 * to ignore.
 */
export const CHAKRA_INTRO: readonly string[] = [
  "You are working on a **Chakra UI v2** Velloo design folder. Components are real Chakra: `Box`/`Flex`/`Stack`/`HStack`/`VStack`/`Grid`+`GridItem`/`Container`/`Spacer` for layout, `Card`+`CardHeader`/`CardBody`/`CardFooter`, `Heading`/`Text` (ALL text — `size` picks the heading scale), `Button`/`IconButton`, `Input`/`Textarea`/`Select`/`Checkbox`/`Radio`/`Switch`/`Slider`+parts, `Badge`/`Tag`/`Avatar`/`Alert`+parts/`Stat`+parts/`Progress`/`Skeleton`, `TableContainer`+`Table`/`Thead`/`Tbody`/`Tr`/`Th`/`Td`, `Tabs`+parts, `List`/`ListItem`, `Breadcrumb`+parts, and the overlay surface `Modal`/`Drawer`/`Popover`/`Menu`/`Tooltip` (chakra's composition parts are registered and render open + inline in design mode). Call `list_components` for the full set + per-component `example` props, and `get_theme` for the tokens. Designs are static — handlers/routing/forms are no-op.",
  "",
  '**Style with the `sx` object, not Tailwind classes.** Use `set_style { style: { display: "flex", alignItems: "center", gap: 4, p: 6, color: "brand.600" } }` — an object (merges shallowly; an inner `null` drops a key; `style: null` clears). `sx` keys are Chakra style props; spacing is the chakra scale (`p: 4` = 16px); color values take theme tokens — `"brand.500"` is the theme\'s primary scale, `"chakra-body-bg"`/`"chakra-subtle-text"` are the semantic surfaces, and `"gray.600"` etc. work too. Prefer component props (`colorScheme`, `variant`, `size`, `spacing`) over sx where they exist — `colorScheme="brand"` is the primary-colored variant.',
  "",
  '`emit_code` emits idiomatic `<Component sx={{…}} />` importing from `"@chakra-ui/react"`; `emit_theme` emits an `extendTheme(...)` module (default `chakra-theme.ts`) — wire it with `<ChakraProvider theme={theme}>`. Overlays are design-mode shims rendered pinned open: the emitted composition (`Modal > ModalContent > …`) is real chakra, but add the `isOpen`/`onClose` disclosure wiring when implementing. **The Tailwind-specific guidance in the rest of these instructions — `className`, semantic utility tokens (`bg-background`, `text-muted-foreground`) and the `audit` tool — is for shadcn folders and does NOT apply here.**',
  "",
];
