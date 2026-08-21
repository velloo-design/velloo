import type { ComponentDescriptor, Manifest, PropDescriptor } from "@velloo/provider";

/**
 * Hand-authored MUI manifest for the shipped registry — curated to the props an
 * agent actually sets (variant/color/size, the `sx` style channel, children),
 * which reads far better than a generated dump of MUI's vast type surface. A
 * ts-morph `.d.ts` generator remains an option for breadth, but the curated
 * manifest is the chosen default; this stays the source of truth.
 */

const sx: PropDescriptor = {
  name: "sx",
  type: "SxProps | undefined",
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

function ui(
  id: string,
  props: PropDescriptor[],
  notes?: string,
  example?: Record<string, unknown>,
): ComponentDescriptor {
  return {
    id,
    category: "ui",
    source: "mui",
    props: [...props, sx],
    designModeNotes: notes,
    example,
  };
}

export const MUI_MANIFEST: Manifest = [
  ui("Box", [children], "Generic layout primitive; style via sx."),
  ui(
    "Stack",
    [children, enumProp("direction", ["row", "column"], "column")],
    "Flex layout; set spacing via sx or the spacing prop.",
  ),
  ui(
    "Container",
    [children, enumProp("maxWidth", ["xs", "sm", "md", "lg", "xl"], "lg")],
    "Centers + max-widths content.",
  ),
  ui("Paper", [children, enumProp("variant", ["elevation", "outlined"], "elevation")]),
  ui("Card", [children, enumProp("variant", ["elevation", "outlined"], "elevation")]),
  ui("CardContent", [children]),
  ui("CardHeader", [
    { name: "title", type: "ReactNode", optional: true, control: "string" },
    { name: "subheader", type: "ReactNode", optional: true, control: "string" },
  ]),
  ui("CardActions", [children]),
  ui(
    "Button",
    [
      children,
      enumProp("variant", ["text", "outlined", "contained"], "text"),
      enumProp("color", ["primary", "secondary", "success", "error", "inherit"], "primary"),
      enumProp("size", ["small", "medium", "large"], "medium"),
    ],
    "Action button.",
    { variant: "contained", color: "primary", children: "Submit" },
  ),
  ui(
    "Typography",
    [
      children,
      enumProp(
        "variant",
        [
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "subtitle1",
          "subtitle2",
          "body1",
          "body2",
          "caption",
          "overline",
        ],
        "body1",
      ),
      enumProp("color", ["text.primary", "text.secondary", "primary", "error"]),
    ],
    "All text. Pick variant for the type scale; this is MUI's Heading + Text.",
    { variant: "h4", children: "Team analytics" },
  ),
  ui("TextField", [
    enumProp("variant", ["outlined", "filled", "standard"], "outlined"),
    { name: "label", type: "string", optional: true, control: "string" },
    { name: "placeholder", type: "string", optional: true, control: "string" },
  ]),
  ui("Chip", [
    { name: "label", type: "ReactNode", optional: true, control: "string" },
    enumProp("variant", ["filled", "outlined"], "filled"),
    enumProp("color", ["default", "primary", "success", "warning", "error"], "default"),
    enumProp("size", ["small", "medium"], "medium"),
  ]),
  ui("Divider", []),
  ui("Avatar", [children, { name: "src", type: "string", optional: true, control: "string" }]),
  ui("LinearProgress", [
    { name: "value", type: "number", optional: true, control: "number" },
    enumProp("variant", ["determinate", "indeterminate"], "indeterminate"),
  ]),
  ui("AppBar", [
    children,
    enumProp("position", ["fixed", "static", "sticky"], "fixed"),
    enumProp("color", ["primary", "default", "transparent", "inherit"], "primary"),
  ]),
  ui("Toolbar", [children]),
  ui("IconButton", [children, enumProp("size", ["small", "medium", "large"], "medium")]),
  ui("Link", [children, { name: "href", type: "string", optional: true, control: "string" }]),
  ui("List", [children]),
  ui("ListItem", [children]),
  ui("ListItemText", [
    { name: "primary", type: "ReactNode", optional: true, control: "string" },
    { name: "secondary", type: "ReactNode", optional: true, control: "string" },
  ]),
  ui("Table", [children]),
  ui("TableHead", [children]),
  ui("TableBody", [children]),
  ui("TableRow", [children]),
  ui("TableCell", [children, enumProp("align", ["left", "center", "right"], "left")]),
  ui("Tabs", [
    children,
    { name: "value", type: "number | string", optional: true, control: "string" },
  ]),
  ui("Tab", [{ name: "label", type: "ReactNode", optional: true, control: "string" }]),
  ui("Badge", [
    children,
    { name: "badgeContent", type: "ReactNode", optional: true, control: "string" },
  ]),
  ui("Checkbox", [{ name: "checked", type: "boolean", optional: true, control: "boolean" }]),
  ui("Switch", [{ name: "checked", type: "boolean", optional: true, control: "boolean" }]),
  ui("Select", [children, enumProp("variant", ["outlined", "filled", "standard"], "outlined")]),
  ui("MenuItem", [
    children,
    { name: "value", type: "string | number", optional: true, control: "string" },
  ]),
  ui("Tooltip", [
    children,
    { name: "title", type: "ReactNode", optional: true, control: "string" },
  ]),
  ui("Alert", [children, enumProp("severity", ["success", "info", "warning", "error"], "success")]),

  // Overlay surface — canvas-safe: rendered OPEN + inline in design mode (no
  // portal/backdrop), so build the content directly inside them.
  ui(
    "Dialog",
    [children, enumProp("maxWidth", ["xs", "sm", "md", "lg", "xl"], "sm")],
    "Modal dialog surface — renders open + inline in design mode. Fill it with DialogTitle / DialogContent / DialogActions.",
    { maxWidth: "sm" },
  ),
  ui("DialogTitle", [children], "The dialog's heading row."),
  ui("DialogContent", [children], "The dialog's body."),
  ui("DialogContentText", [children], "Secondary text inside DialogContent."),
  ui("DialogActions", [children], "The dialog's button row (right-aligned)."),
  ui(
    "Menu",
    [children],
    "A menu surface holding MenuItems — renders open + inline in design mode.",
  ),
  ui("Popover", [children], "A popover surface — renders open + inline in design mode."),
  ui("Drawer", [children], "A side panel — renders inline as a fixed-width column in design mode."),
  ui(
    "Snackbar",
    [children, { name: "message", type: "ReactNode", optional: true, control: "string" }],
    "A toast — renders inline as a dark pill in design mode. Use `message` or children.",
    { message: "Saved" },
  ),
];
