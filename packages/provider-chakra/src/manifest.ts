import type { ComponentDescriptor, Manifest, PropDescriptor } from "@velloo/provider";

/**
 * Hand-authored chakra manifest for the shipped registry — curated to the
 * props an agent actually sets (colorScheme/variant/size, the `sx` style
 * channel, children), which reads far better than a generated dump of chakra's
 * vast style-prop surface. Mirrors the MUI/antd adapters' curated-manifest
 * stance; this stays the source of truth.
 */

const sx: PropDescriptor = {
  name: "sx",
  type: "SystemStyleObject | undefined",
  optional: true,
  control: "string",
};
const children: PropDescriptor = {
  name: "children",
  type: "ReactNode",
  optional: true,
  control: "string",
};
const enumProp = (name: string, values: string[], defaultValue?: string): PropDescriptor => ({
  name,
  type: values.map((v) => `"${v}"`).join(" | "),
  optional: true,
  control: "enum",
  enumValues: values,
  defaultValue,
});
const str = (name: string, optional = true): PropDescriptor => ({
  name,
  type: "string",
  optional,
  control: "string",
});
const num = (name: string): PropDescriptor => ({
  name,
  type: "number",
  optional: true,
  control: "number",
});
const bool = (name: string): PropDescriptor => ({
  name,
  type: "boolean",
  optional: true,
  control: "boolean",
});
const json = (name: string, type: string): PropDescriptor => ({
  name,
  type,
  optional: true,
  control: "string",
});

const colorScheme = enumProp(
  "colorScheme",
  ["brand", "gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"],
  "gray",
);
const sizeSmMdLg = (defaultValue = "md") =>
  enumProp("size", ["xs", "sm", "md", "lg"], defaultValue);

function ui(
  id: string,
  props: PropDescriptor[],
  notes?: string,
  example?: Record<string, unknown>,
): ComponentDescriptor {
  return {
    id,
    category: "ui",
    source: "chakra",
    props: [...props, sx],
    designModeNotes: notes,
    example,
  };
}

const className: PropDescriptor = {
  name: "className",
  type: "string | undefined",
  optional: true,
  control: "string",
};

/** A reused framework-neutral velloo helper (source "velloo") — styled via className, not sx. */
function helper(
  id: string,
  props: PropDescriptor[],
  notes?: string,
  example?: Record<string, unknown>,
): ComponentDescriptor {
  return {
    id,
    category: "ui",
    source: "velloo",
    props: [...props, className],
    designModeNotes: notes,
    example,
  };
}

export const CHAKRA_MANIFEST: Manifest = [
  // --- layout ---
  ui("Box", [children], "Generic layout primitive; style via sx."),
  ui(
    "Flex",
    [children, json("gap", "number | string"), str("align"), str("justify"), str("direction")],
    "Flex row/column wrapper — `direction`/`align`/`justify`/`gap` are shortcuts; anything else via sx.",
    { gap: 4, align: "center" },
  ),
  ui(
    "Stack",
    [children, num("spacing"), enumProp("direction", ["row", "column"], "column")],
    "Spaced flex layout; `spacing` is the chakra scale (4 = 1rem).",
    { spacing: 4 },
  ),
  ui("HStack", [children, num("spacing")], "Horizontal Stack.", { spacing: 3 }),
  ui("VStack", [children, num("spacing"), str("align")], "Vertical Stack.", {
    spacing: 4,
    align: "stretch",
  }),
  ui(
    "Grid",
    [children, str("templateColumns"), json("gap", "number | string")],
    "CSS grid wrapper; pair with GridItem.",
    { templateColumns: "repeat(3, 1fr)", gap: 6 },
  ),
  ui("GridItem", [children, num("colSpan")], "One cell inside a Grid.", { colSpan: 1 }),
  ui(
    "Container",
    [children, str("maxW"), bool("centerContent")],
    'Centers + max-widths content. `maxW` takes a size token ("md", "3xl", "container.lg").',
    { maxW: "3xl" },
  ),
  ui("Spacer", [], "Flexible gap inside a Flex/HStack — pushes siblings apart."),

  // --- surfaces + data display ---
  ui(
    "Card",
    [children, enumProp("variant", ["elevated", "outline", "filled"], "elevated")],
    "Card surface — compose with CardHeader/CardBody/CardFooter children.",
    { variant: "outline" },
  ),
  ui("CardHeader", [children], "Card title area — put a Heading inside."),
  ui("CardBody", [children]),
  ui("CardFooter", [children], "Card action row."),
  ui(
    "Alert",
    [children, enumProp("status", ["info", "success", "warning", "error"], "info")],
    "Inline alert banner — compose with AlertIcon + AlertTitle + AlertDescription children.",
    { status: "info" },
  ),
  ui("AlertIcon", [], "The status icon inside an Alert."),
  ui("AlertTitle", [children], undefined, { children: "Workspace synced" }),
  ui("AlertDescription", [children], undefined, { children: "All changes are saved." }),
  ui(
    "Badge",
    [children, colorScheme, enumProp("variant", ["subtle", "solid", "outline"], "subtle")],
    "Small status label.",
    { colorScheme: "green", children: "Active" },
  ),
  ui(
    "Tag",
    [
      children,
      colorScheme,
      enumProp("variant", ["subtle", "solid", "outline"], "subtle"),
      sizeSmMdLg(),
    ],
    "Label chip — larger than Badge.",
    { colorScheme: "brand", children: "Design" },
  ),
  ui(
    "Avatar",
    [str("name"), str("src"), enumProp("size", ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"], "md")],
    "Avatar — `src` image or initials derived from `name`.",
    { name: "Ada Lovelace" },
  ),
  ui("Divider", [enumProp("orientation", ["horizontal", "vertical"], "horizontal")]),
  ui("Skeleton", [children, json("height", "number | string")], "Loading placeholder block.", {
    height: "20px",
  }),
  ui("Progress", [num("value"), colorScheme, sizeSmMdLg(), bool("hasStripe")], undefined, {
    value: 62,
    colorScheme: "brand",
  }),
  ui(
    "Stat",
    [children],
    "A KPI block — compose with StatLabel + StatNumber + StatHelpText children.",
  ),
  ui("StatLabel", [children], undefined, { children: "Active users" }),
  ui("StatNumber", [children], undefined, { children: "112,893" }),
  ui("StatHelpText", [children], "Secondary line — put a StatArrow inside for a delta.", {
    children: "23% more than last week",
  }),
  ui("StatArrow", [enumProp("type", ["increase", "decrease"], "increase")], undefined, {
    type: "increase",
  }),

  // --- typography ---
  ui(
    "Heading",
    [
      children,
      enumProp("size", ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"], "xl"),
      str("as"),
    ],
    "A heading — pick `size` for the scale (`as` sets the tag, default h2).",
    { size: "lg", children: "Team analytics" },
  ),
  ui(
    "Text",
    [children, str("fontSize"), str("color"), str("as")],
    'ALL body text. Tone via sx/props: `color: "chakra-subtle-text"` for muted, theme tokens like "brand.600" work.',
    { fontSize: "sm", color: "chakra-subtle-text", children: "Updated 2 hours ago" },
  ),

  // --- controls ---
  ui(
    "Button",
    [
      children,
      enumProp("variant", ["solid", "outline", "ghost", "link"], "solid"),
      colorScheme,
      sizeSmMdLg(),
      bool("isDisabled"),
    ],
    'Action button. `colorScheme="brand"` is the theme\'s primary.',
    { colorScheme: "brand", children: "Submit" },
  ),
  ui(
    "IconButton",
    [
      str("aria-label", false),
      children,
      enumProp("variant", ["solid", "outline", "ghost"], "solid"),
      colorScheme,
      sizeSmMdLg(),
    ],
    "Icon-only button — give it a velloo `Icon` child + an aria-label.",
    { "aria-label": "Settings", variant: "ghost" },
  ),
  ui(
    "Input",
    [
      str("placeholder"),
      str("value"),
      sizeSmMdLg(),
      enumProp("variant", ["outline", "filled", "flushed"], "outline"),
    ],
    undefined,
    { placeholder: "Email address" },
  ),
  ui("Textarea", [str("placeholder"), str("value")], undefined, {
    placeholder: "Tell us more…",
  }),
  ui(
    "Select",
    [str("placeholder"), sizeSmMdLg()],
    "Closed select field in design mode — use `placeholder` for the visible value (option children don't fit design JSON).",
    { placeholder: "Pick a role" },
  ),
  ui("Checkbox", [children, bool("isChecked"), colorScheme], undefined, {
    isChecked: true,
    children: "Remember me",
  }),
  ui("Radio", [children, bool("isChecked"), colorScheme], undefined, {
    isChecked: true,
    children: "Monthly",
  }),
  ui("Switch", [bool("isChecked"), colorScheme, sizeSmMdLg()], undefined, {
    isChecked: true,
    colorScheme: "brand",
  }),
  ui(
    "Slider",
    [children, num("value"), num("min"), num("max"), colorScheme],
    "Compose: Slider > SliderTrack > SliderFilledTrack, + SliderThumb.",
    { value: 30, colorScheme: "brand" },
  ),
  ui("SliderTrack", [children], "The rail — put SliderFilledTrack inside."),
  ui("SliderFilledTrack", []),
  ui("SliderThumb", []),

  // --- data ---
  ui("TableContainer", [children], "Overflow wrapper — put the Table inside."),
  ui(
    "Table",
    [children, enumProp("variant", ["simple", "striped", "unstyled"], "simple"), sizeSmMdLg()],
    "Data table — compose Thead > Tr > Th and Tbody > Tr > Td children (no data props).",
    { variant: "simple" },
  ),
  ui("Thead", [children]),
  ui("Tbody", [children]),
  ui("Tr", [children]),
  ui("Th", [children, bool("isNumeric")], undefined, { children: "Name" }),
  ui("Td", [children, bool("isNumeric")], undefined, { children: "Ada Lovelace" }),
  ui(
    "Tabs",
    [
      children,
      num("defaultIndex"),
      enumProp("variant", ["line", "enclosed", "soft-rounded", "solid-rounded"], "line"),
      colorScheme,
    ],
    "Compose: Tabs > TabList (Tab children) + TabPanels (TabPanel children). Set `defaultIndex` to pick the visible pane.",
    { defaultIndex: 0, colorScheme: "brand" },
  ),
  ui("TabList", [children]),
  ui("Tab", [children], undefined, { children: "Overview" }),
  ui("TabPanels", [children]),
  ui("TabPanel", [children]),
  ui("List", [children, num("spacing")], "Compose with ListItem children.", { spacing: 2 }),
  ui("ListItem", [children], undefined, { children: "Deploy finished" }),
  ui("Breadcrumb", [children, str("separator")], "Compose: BreadcrumbItem > BreadcrumbLink."),
  ui("BreadcrumbItem", [children, bool("isCurrentPage")]),
  ui("BreadcrumbLink", [children, str("href")], undefined, { href: "#", children: "Home" }),

  // --- overlay surface — canvas-safe: rendered OPEN + inline in design mode
  // (chakra's own overlays portal and SSR to nothing; their parts need the
  // real parent's context), so build the content directly inside them. ---
  ui(
    "Modal",
    [children, enumProp("size", ["xs", "sm", "md", "lg", "xl", "2xl", "full"], "md")],
    "Modal dialog — renders open + inline in design mode. Compose: Modal > ModalOverlay + ModalContent > ModalHeader/ModalBody/ModalFooter (+ ModalCloseButton). Emitted code needs isOpen/onClose wiring.",
    { size: "md" },
  ),
  ui(
    "ModalOverlay",
    [],
    "The backdrop — renders nothing in design mode (kept for chakra-idiomatic composition).",
  ),
  ui("ModalContent", [children], "The modal surface card."),
  ui("ModalHeader", [children], undefined, { children: "Delete item?" }),
  ui("ModalBody", [children]),
  ui("ModalFooter", [children], "Right-aligned action row."),
  ui("ModalCloseButton", [], "Pinned top-right close button."),
  ui(
    "Drawer",
    [children],
    "A side panel — renders inline as a fixed-width column in design mode. Compose: Drawer > DrawerOverlay + DrawerContent > DrawerHeader/DrawerBody/DrawerFooter.",
  ),
  ui("DrawerOverlay", [], "The backdrop — renders nothing in design mode."),
  ui("DrawerContent", [children], "The drawer surface column."),
  ui("DrawerHeader", [children], undefined, { children: "Filters" }),
  ui("DrawerBody", [children]),
  ui("DrawerFooter", [children]),
  ui(
    "Popover",
    [children],
    "The trigger child renders inline with the surface pinned open below it. Compose: Popover > PopoverTrigger (the trigger) + PopoverContent > PopoverHeader/PopoverBody.",
  ),
  ui("PopoverTrigger", [children], "Wraps the trigger element — renders it as-is."),
  ui("PopoverContent", [children], "The popover surface, pinned open."),
  ui("PopoverHeader", [children], undefined, { children: "Details" }),
  ui("PopoverBody", [children]),
  ui("PopoverArrow", [], "Renders nothing in design mode (kept for chakra-idiomatic composition)."),
  ui(
    "Menu",
    [children],
    "The trigger renders inline with the menu pinned open below it. Compose: Menu > MenuButton (the trigger) + MenuList > MenuItem/MenuDivider.",
  ),
  ui("MenuButton", [children], "The trigger — renders as a chakra Button in design mode.", {
    children: "Actions",
  }),
  ui("MenuList", [children], "The menu surface, pinned open."),
  ui("MenuItem", [children], undefined, { children: "Edit" }),
  ui("MenuDivider", []),
  ui(
    "Tooltip",
    [children, str("label")],
    "The trigger child renders inline; `label` shows beside it as a dark pill in design mode.",
    { label: "Copy to clipboard" },
  ),

  // Framework-neutral velloo helpers (chakra's @chakra-ui/icons isn't shipped).
  // source:"velloo" — sized/styled via props (NOT sx or Tailwind: a chakra
  // folder has no JIT). `Icon` emits a lucide-react import in codegen.
  helper(
    "Icon",
    [
      { name: "name", type: "string", optional: false, control: "icon" },
      { name: "size", type: "number", optional: true, control: "number" },
    ],
    "A lucide icon — chakra's icon set isn't bundled. Set the pixel `size` prop (not sx). `name` is a lucide id (PascalCase or kebab). Emits a `lucide-react` import.",
    { name: "ArrowRight", size: 20 },
  ),
  helper(
    "Image",
    [
      { name: "src", type: "string", optional: false, control: "string" },
      { name: "alt", type: "string", optional: false, control: "string" },
    ],
    "An image. Use velloo assets (`/assets/…`) or a URL.",
  ),
  helper(
    "Placeholder",
    [{ name: "label", type: "string", optional: true, control: "string" }],
    "A labeled placeholder box for imagery you haven't authored yet (avatars, hero shots).",
  ),
  helper(
    "SVG",
    [
      { name: "content", type: "string", optional: false, control: "string" },
      { name: "viewBox", type: "string", optional: false, control: "string" },
    ],
    "Raw inline SVG markup.",
  ),
  helper("Layer", [children], "An absolutely-positioned overlay layer for stacked composition."),
  helper(
    "Gradient",
    [{ name: "from", type: "string", optional: true, control: "color" }],
    "A gradient fill block.",
  ),
];
