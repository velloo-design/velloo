import type { ComponentDescriptor, Manifest, PropDescriptor } from "@velloo/provider";

/**
 * Hand-authored antd manifest for the shipped registry — curated to the props
 * an agent actually sets (type/size/items, the inline `style` channel,
 * children), which reads far better than a generated dump of antd's vast type
 * surface. Mirrors the MUI adapter's curated-manifest stance; this stays the
 * source of truth.
 */

const style: PropDescriptor = {
  name: "style",
  type: "CSSProperties | undefined",
  optional: true,
  control: "string",
};
const children: PropDescriptor = {
  name: "children",
  type: "ReactNode",
  optional: true,
  control: "string",
};
const enumProp = (
  name: string,
  values: (string | number)[],
  defaultValue?: string,
): PropDescriptor => ({
  name,
  type: values.map((v) => (typeof v === "string" ? `"${v}"` : `${v}`)).join(" | "),
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
const node = (name: string): PropDescriptor => ({
  name,
  type: "ReactNode",
  optional: true,
  control: "string",
});
const json = (name: string, type: string): PropDescriptor => ({
  name,
  type,
  optional: true,
  control: "string",
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
    source: "antd",
    props: [...props, style],
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

/** A reused framework-neutral velloo helper (source "velloo") — styled via className, not the antd style channel. */
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

export const ANTD_MANIFEST: Manifest = [
  // --- layout ---
  ui(
    "Flex",
    [
      children,
      bool("vertical"),
      json("gap", '"small" | "middle" | "large" | number'),
      str("align"),
      str("justify"),
      bool("wrap"),
    ],
    "The flex layout primitive — use it for every row/column wrapper.",
    { vertical: false, gap: "middle", align: "center" },
  ),
  ui(
    "Space",
    [
      children,
      enumProp("direction", ["horizontal", "vertical"], "horizontal"),
      json("size", '"small" | "middle" | "large" | number'),
    ],
    "Inline spacing between adjacent items (buttons, tags).",
    { size: "middle" },
  ),
  ui("Row", [children, num("gutter")], "Grid row; pair with Col spans (24-column grid).", {
    gutter: 16,
  }),
  ui("Col", [children, num("span")], "Grid column inside a Row; span is out of 24.", { span: 12 }),

  // --- surfaces + data display ---
  ui(
    "Card",
    [children, node("title"), node("extra"), enumProp("size", ["default", "small"], "default")],
    "Card surface with an optional title bar.",
    { title: "Team" },
  ),
  ui(
    "Alert",
    [
      node("message"),
      node("description"),
      enumProp("type", ["success", "info", "warning", "error"], "info"),
      bool("showIcon"),
    ],
    "Inline alert banner. `message` is the headline; `description` the body.",
    { type: "info", message: "Workspace synced", showIcon: true },
  ),
  ui(
    "Tag",
    [children, str("color")],
    'Label chip. `color` takes a preset ("success", "processing", "error", "warning") or any CSS color.',
    { color: "success", children: "Active" },
  ),
  ui(
    "Badge",
    [children, num("count"), bool("dot"), num("overflowCount")],
    "Count/dot indicator wrapping its child (an Avatar, an icon).",
    { count: 5 },
  ),
  ui("Avatar", [children, str("src"), num("size")], "Avatar — `src` image or text children.", {
    children: "AB",
  }),
  ui("Divider", [children, enumProp("type", ["horizontal", "vertical"], "horizontal")]),
  ui("Skeleton", [bool("active"), bool("avatar")], "Loading placeholder blocks.", {
    active: true,
  }),
  ui("Empty", [node("description")], "Empty-state illustration + caption.", {
    description: "No data yet",
  }),
  ui(
    "Statistic",
    [node("title"), json("value", "string | number"), node("prefix"), node("suffix")],
    "A KPI number with a label.",
    { title: "Active users", value: 112893 },
  ),
  ui(
    "Progress",
    [
      num("percent"),
      enumProp("type", ["line", "circle", "dashboard"], "line"),
      enumProp("status", ["normal", "active", "success", "exception"]),
    ],
    undefined,
    { percent: 62 },
  ),

  // --- typography (antd's Typography.* exposed as flat ids) ---
  ui(
    "TypographyTitle",
    [children, enumProp("level", [1, 2, 3, 4, 5], "1")],
    "A heading — antd's Typography.Title. Pick `level` for the scale (1 largest).",
    { level: 2, children: "Team analytics" },
  ),
  ui(
    "TypographyText",
    [
      children,
      enumProp("type", ["secondary", "success", "warning", "danger"]),
      bool("strong"),
      bool("code"),
    ],
    "Inline text — antd's Typography.Text. `type` picks the semantic tone.",
    { type: "secondary", children: "Updated 2 hours ago" },
  ),
  ui(
    "TypographyParagraph",
    [children, enumProp("type", ["secondary", "success", "warning", "danger"])],
    "Block paragraph — antd's Typography.Paragraph.",
    { children: "Body copy for a section." },
  ),

  // --- controls ---
  ui(
    "Button",
    [
      children,
      enumProp("type", ["primary", "default", "dashed", "text", "link"], "default"),
      bool("danger"),
      enumProp("size", ["small", "middle", "large"], "middle"),
      bool("block"),
    ],
    "Action button.",
    { type: "primary", children: "Submit" },
  ),
  ui(
    "Input",
    [str("placeholder"), str("value"), enumProp("size", ["small", "middle", "large"], "middle")],
    undefined,
    { placeholder: "Email address" },
  ),
  ui(
    "Select",
    [
      str("placeholder"),
      str("value"),
      json("options", "{ value: string; label: string }[]"),
      enumProp("size", ["small", "middle", "large"], "middle"),
    ],
    "Closed select field in design mode (the dropdown is a portal).",
    {
      placeholder: "Pick a role",
      options: [
        { value: "admin", label: "Admin" },
        { value: "viewer", label: "Viewer" },
      ],
    },
  ),
  ui("Checkbox", [children, bool("checked")], undefined, {
    checked: true,
    children: "Remember me",
  }),
  ui("Radio", [children, bool("checked")], undefined, { checked: true, children: "Monthly" }),
  ui("Switch", [bool("checked"), enumProp("size", ["default", "small"], "default")], undefined, {
    checked: true,
  }),
  ui(
    "Segmented",
    [json("options", "(string | number)[]"), json("value", "string | number")],
    "Segmented control.",
    { options: ["Daily", "Weekly", "Monthly"], value: "Weekly" },
  ),
  ui("Slider", [num("value"), num("min"), num("max")], undefined, { value: 30 }),
  ui("Rate", [num("value"), num("count")], "Star rating.", { value: 4 }),

  // --- data ---
  ui(
    "Table",
    [
      json("columns", "{ title: string; dataIndex: string; key: string }[]"),
      json("dataSource", "Record<string, ReactNode>[] (each row needs a `key`)"),
      enumProp("size", ["large", "middle", "small"], "large"),
      json("pagination", "false | object"),
    ],
    "Data table — drive it with `columns` + `dataSource` (no render functions in design JSON).",
    {
      columns: [
        { title: "Name", dataIndex: "name", key: "name" },
        { title: "Role", dataIndex: "role", key: "role" },
      ],
      dataSource: [
        { key: "1", name: "Ada Lovelace", role: "Admin" },
        { key: "2", name: "Grace Hopper", role: "Member" },
      ],
      pagination: false,
    },
  ),
  ui(
    "List",
    [children, enumProp("size", ["default", "small", "large"], "default"), bool("bordered")],
    "Compose with ListItem children (skip `dataSource`/`renderItem` — functions don't fit design JSON).",
    { bordered: true },
  ),
  ui("ListItem", [children], "One row inside a List — antd's List.Item."),
  ui(
    "ListItemMeta",
    [node("title"), node("description"), node("avatar")],
    "Title/description/avatar layout inside a ListItem — antd's List.Item.Meta.",
    { title: "Deploy finished", description: "2 minutes ago" },
  ),
  ui(
    "Tabs",
    [json("items", "{ key: string; label: string; children?: ReactNode }[]"), str("activeKey")],
    "Tab bar + active pane, driven by `items`.",
    {
      items: [
        { key: "1", label: "Overview", children: "Overview content" },
        { key: "2", label: "Settings", children: "Settings content" },
      ],
    },
  ),
  ui(
    "Steps",
    [num("current"), json("items", "{ title: string; description?: string }[]")],
    undefined,
    { current: 1, items: [{ title: "Build" }, { title: "Review" }, { title: "Ship" }] },
  ),
  ui("Breadcrumb", [json("items", "{ title: ReactNode }[]")], undefined, {
    items: [{ title: "Home" }, { title: "Reports" }],
  }),
  ui("Pagination", [num("current"), num("total"), num("pageSize")], undefined, {
    current: 1,
    total: 50,
  }),
  ui(
    "Menu",
    [
      json("items", "{ key: string; label: ReactNode; icon?: ReactNode }[]"),
      enumProp("mode", ["vertical", "horizontal", "inline"], "vertical"),
      json("selectedKeys", "string[]"),
    ],
    "Navigation menu driven by `items` (antd v5 dropped JSX children menus).",
    {
      mode: "inline",
      items: [
        { key: "home", label: "Home" },
        { key: "reports", label: "Reports" },
      ],
      selectedKeys: ["home"],
    },
  ),

  // --- overlay surface — canvas-safe: rendered OPEN + inline in design mode
  // (antd's own overlays portal and SSR to nothing), so build the content
  // directly inside them. ---
  ui(
    "Modal",
    [children, node("title"), num("width"), node("footer")],
    "Modal dialog surface — renders open + inline in design mode. Put the body in children; `footer` renders as a right-aligned action row.",
    { title: "Delete item?" },
  ),
  ui(
    "Drawer",
    [children, node("title")],
    "A side panel — renders inline as a fixed-width column in design mode.",
    { title: "Filters" },
  ),
  ui(
    "Popover",
    [children, node("title"), node("content")],
    "A popover — the trigger child renders inline with the surface pinned open below it.",
    { title: "Details", content: "Popover body" },
  ),
  ui(
    "Tooltip",
    [children, node("title")],
    "The trigger child renders inline; `title` shows beside it as a dark pill in design mode.",
    { title: "Copy to clipboard" },
  ),
  ui(
    "Dropdown",
    [children, json("menu", "{ items: { key: string; label: ReactNode }[] }")],
    "The trigger child renders inline with the menu surface pinned open below it.",
    {
      menu: {
        items: [
          { key: "edit", label: "Edit" },
          { key: "delete", label: "Delete" },
        ],
      },
    },
  ),

  // Framework-neutral velloo helpers (antd's @ant-design/icons isn't shipped).
  // source:"velloo" — sized/styled via props (NOT the antd style channel or
  // Tailwind: an antd folder has no JIT). `Icon` emits a lucide-react import
  // in codegen.
  helper(
    "Icon",
    [
      { name: "name", type: "string", optional: false, control: "icon" },
      { name: "size", type: "number", optional: true, control: "number" },
    ],
    "A lucide icon — antd's icon set isn't bundled. Set the pixel `size` prop (not Tailwind). `name` is a lucide id (PascalCase or kebab). Emits a `lucide-react` import.",
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
