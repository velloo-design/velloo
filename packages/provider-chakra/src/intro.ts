/**
 * MCP framing for a chakra folder: `CHAKRA_INTRO` is the brief's paragraph
 * (`FrameworkAdapter.mcpIntro`), `CHAKRA_NOTES` what `list_components` hands
 * over with its index (`mcpNotes`).
 */
export const CHAKRA_INTRO =
  '**This folder targets Chakra UI v2**: real Chakra, `Heading`/`Text` for ALL text. **Style through `sx`** (Chakra style props, tokens like `"brand.500"`); prefer props like `colorScheme`.';

export const CHAKRA_NOTES: readonly string[] = [
  'Components are real Chakra: `Box`/`Flex`/`Stack`/`HStack`/`VStack`/`Grid`+`GridItem`/`Container`/`Spacer` for layout, `Card`+`CardHeader`/`CardBody`/`CardFooter`, `Heading`/`Text` (`size` picks the heading scale), `Button`/`IconButton`, `Input`/`Textarea`/`Select`/`Checkbox`/`Radio`/`Switch`/`Slider`+parts, `Badge`/`Tag`/`Avatar`/`Alert`+parts/`Stat`+parts/`Progress`/`Skeleton`, `TableContainer`+`Table`/`Thead`/`Tbody`/`Tr`/`Th`/`Td`, `Tabs`+parts, `List`/`ListItem`, `Breadcrumb`+parts, and the overlays `Modal`/`Drawer`/`Popover`/`Menu`/`Tooltip` (their composition parts render open and inline in design mode). `mode: "full"` gives per-component `example` props.',
  '`sx` is an object: it merges shallowly, an inner `null` drops a key, `style: null` clears. `"brand.500"` is the theme\'s primary scale, `"chakra-body-bg"`/`"chakra-subtle-text"` the semantic surfaces, and `"gray.600"` etc. work too; `colorScheme="brand"` is the primary-colored variant.',
  '`emit_code` emits `<Component sx={{…}} />` importing from `"@chakra-ui/react"`; `emit_theme` emits an `extendTheme(...)` module (default `chakra-theme.ts`) — wire it with `<ChakraProvider theme={theme}>`. Overlays are emitted as real chakra compositions (`Modal > ModalContent > …`), but add the `isOpen`/`onClose` wiring when implementing. Tailwind utility diagnostics do not apply.',
];
