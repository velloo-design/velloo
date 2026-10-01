import type { ComponentDescriptor, Manifest, PropDescriptor } from "@velloo/provider";

/**
 * Hand-authored antd manifest for the shipped registry — curated to the props
 * an agent actually sets (type/size/items, the inline `style` channel,
 * children), which reads far better than a generated dump of antd's vast type
 * surface. Mirrors the MUI adapter's curated-manifest stance; this stays the
 * source of truth.
 *
 * Curated means leaving out handlers, render functions, deprecated aliases and
 * prefixCls plumbing — not leaving out real visual props. A listed component
 * warns on every prop it doesn't list, so a missing `strokeColor` teaches the
 * agent that antd lacks it. Each entry was audited against antd's own prop
 * types (`<Name>Props`) for every serializable, design-relevant prop.
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
const color = (name: string): PropDescriptor => ({
  name,
  type: "string",
  optional: true,
  control: "color",
});
const css = (name: string): PropDescriptor => json(name, "CSSProperties");
/** antd's per-part inline styles (`styles={{ body: {…} }}`) — the style channel for inner parts. */
const styles = (parts: string): PropDescriptor =>
  json(
    "styles",
    `{ ${parts
      .split(" ")
      .map((part) => `${part}?: CSSProperties`)
      .join("; ")} }`,
  );
const SIZES = ["small", "middle", "large"];
const STATUS = ["error", "warning"];
const VARIANTS = ["outlined", "borderless", "filled", "underlined"];
const PLACEMENTS = [
  "top",
  "left",
  "right",
  "bottom",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
  "leftTop",
  "leftBottom",
  "rightTop",
  "rightBottom",
];
/** Typography's shared text decorations — Title, Text and Paragraph all take them. */
const TEXT_DECORATIONS: PropDescriptor[] = [
  bool("code"),
  bool("mark"),
  bool("keyboard"),
  bool("italic"),
  bool("underline"),
  bool("delete"),
  bool("disabled"),
  json("ellipsis", "boolean | { rows?: number; expandable?: boolean }"),
  json("copyable", "boolean | { text?: string }"),
];

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

/**
 * An antd subcomponent whose real export is a dotted path. Neither a manifest id
 * nor a JSX `$ref` can carry a dot, so it browses and composes under the flat id
 * (`Typography.Title` ⇒ `TypographyTitle`) and emits as the dotted export — code
 * the agent writes needs no destructure.
 */
function sub(
  nativeExport: string,
  props: PropDescriptor[],
  notes?: string,
  example?: Record<string, unknown>,
): ComponentDescriptor {
  return { ...ui(nativeExport.replaceAll(".", ""), props, notes, example), nativeExport };
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
      json("wrap", 'boolean | "wrap" | "nowrap" | "wrap-reverse"'),
      json("flex", "string | number"),
      str("component"),
    ],
    "The flex layout primitive — use it for every row/column wrapper.",
    { vertical: false, gap: "middle", align: "center" },
  ),
  ui(
    "Space",
    [
      children,
      enumProp("direction", ["horizontal", "vertical"], "horizontal"),
      json("size", '"small" | "middle" | "large" | number | [number, number]'),
      enumProp("align", ["start", "end", "center", "baseline"]),
      bool("wrap"),
      node("split"),
      styles("item"),
    ],
    "Inline spacing between adjacent items (buttons, tags).",
    { size: "middle" },
  ),
  ui(
    "Row",
    [
      children,
      json("gutter", "number | [number, number] | Partial<Record<Breakpoint, number>>"),
      enumProp("align", ["top", "middle", "bottom", "stretch"]),
      enumProp("justify", [
        "start",
        "end",
        "center",
        "space-around",
        "space-between",
        "space-evenly",
      ]),
      bool("wrap"),
    ],
    "Grid row; pair with Col spans (24-column grid).",
    { gutter: 16 },
  ),
  ui(
    "Col",
    [
      children,
      num("span"),
      num("offset"),
      num("order"),
      num("push"),
      num("pull"),
      json("flex", "string | number"),
      ...["xs", "sm", "md", "lg", "xl", "xxl"].map((bp) =>
        json(bp, "number | { span?: number; offset?: number; order?: number }"),
      ),
    ],
    "Grid column inside a Row; span is out of 24.",
    { span: 12 },
  ),

  // --- surfaces + data display ---
  ui(
    "Card",
    [
      children,
      node("title"),
      node("extra"),
      enumProp("size", ["default", "small"], "default"),
      enumProp("variant", ["outlined", "borderless"], "outlined"),
      bool("bordered"),
      bool("hoverable"),
      bool("loading"),
      node("cover"),
      json("actions", "ReactNode[]"),
      enumProp("type", ["inner"]),
      styles("header body extra title actions cover"),
    ],
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
      node("icon"),
      node("action"),
      bool("banner"),
      bool("closable"),
    ],
    "Inline alert banner. `message` is the headline; `description` the body.",
    { type: "info", message: "Workspace synced", showIcon: true },
  ),
  ui(
    "Tag",
    [children, str("color"), bool("bordered"), node("icon"), bool("closable")],
    'Label chip. `color` takes a preset ("success", "processing", "error", "warning") or any CSS color.',
    { color: "success", children: "Active" },
  ),
  ui(
    "Badge",
    [
      children,
      json("count", "number | ReactNode"),
      bool("dot"),
      num("overflowCount"),
      bool("showZero"),
      color("color"),
      enumProp("status", ["success", "processing", "default", "error", "warning"]),
      node("text"),
      enumProp("size", ["default", "small"], "default"),
      json("offset", "[number, number]"),
    ],
    "Count/dot indicator wrapping its child (an Avatar, an icon).",
    { count: 5 },
  ),
  ui(
    "Avatar",
    [
      children,
      str("src"),
      str("alt"),
      json("size", '"large" | "small" | "default" | number'),
      enumProp("shape", ["circle", "square"], "circle"),
      node("icon"),
      num("gap"),
    ],
    "Avatar — `src` image or text children.",
    { children: "AB" },
  ),
  ui("Divider", [
    children,
    enumProp("type", ["horizontal", "vertical"], "horizontal"),
    enumProp("orientation", ["left", "right", "center", "start", "end"], "center"),
    json("orientationMargin", "string | number"),
    bool("dashed"),
    enumProp("variant", ["solid", "dashed", "dotted"], "solid"),
    bool("plain"),
  ]),
  ui(
    "Skeleton",
    [
      bool("active"),
      json("avatar", "boolean | { shape?: 'circle' | 'square'; size?: number }"),
      json(
        "paragraph",
        "boolean | { rows?: number; width?: number | string | (number | string)[] }",
      ),
      bool("round"),
      bool("loading"),
      children,
    ],
    "Loading placeholder blocks.",
    { active: true },
  ),
  ui(
    "Empty",
    [node("description"), node("image"), children],
    "Empty-state illustration + caption.",
    {
      description: "No data yet",
    },
  ),
  ui(
    "Statistic",
    [
      node("title"),
      json("value", "string | number"),
      node("prefix"),
      node("suffix"),
      css("valueStyle"),
      num("precision"),
      str("groupSeparator"),
      str("decimalSeparator"),
      bool("loading"),
    ],
    "A KPI number with a label.",
    { title: "Active users", value: 112893 },
  ),
  ui(
    "Progress",
    [
      num("percent"),
      enumProp("type", ["line", "circle", "dashboard"], "line"),
      enumProp("status", ["normal", "active", "success", "exception"]),
      json("strokeColor", "string | string[] | { from: string; to: string; direction?: string }"),
      color("trailColor"),
      bool("showInfo"),
      json("size", '"small" | "default" | number | [number | string, number]'),
      num("strokeWidth"),
      enumProp("strokeLinecap", ["round", "butt", "square"], "round"),
      num("steps"),
      json("success", "{ percent?: number; strokeColor?: string }"),
      num("gapDegree"),
      json("percentPosition", '{ align?: "start" | "center" | "end"; type?: "inner" | "outer" }'),
    ],
    undefined,
    { percent: 62 },
  ),

  // --- typography (antd's Typography.* exposed as flat ids) ---
  sub(
    "Typography.Title",
    [
      children,
      enumProp("level", [1, 2, 3, 4, 5], "1"),
      enumProp("type", ["secondary", "success", "warning", "danger"]),
      ...TEXT_DECORATIONS,
    ],
    "A heading — antd's Typography.Title. Pick `level` for the scale (1 largest).",
    { level: 2, children: "Team analytics" },
  ),
  sub(
    "Typography.Text",
    [
      children,
      enumProp("type", ["secondary", "success", "warning", "danger"]),
      bool("strong"),
      ...TEXT_DECORATIONS,
    ],
    "Inline text — antd's Typography.Text. `type` picks the semantic tone.",
    { type: "secondary", children: "Updated 2 hours ago" },
  ),
  sub(
    "Typography.Paragraph",
    [
      children,
      enumProp("type", ["secondary", "success", "warning", "danger"]),
      bool("strong"),
      ...TEXT_DECORATIONS,
    ],
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
      enumProp("size", SIZES, "middle"),
      bool("block"),
      node("icon"),
      enumProp("iconPosition", ["start", "end"], "start"),
      enumProp("shape", ["default", "circle", "round"], "default"),
      enumProp("color", ["default", "primary", "danger"]),
      enumProp("variant", ["outlined", "dashed", "solid", "filled", "text", "link"]),
      bool("ghost"),
      bool("loading"),
      bool("disabled"),
      str("href"),
      enumProp("htmlType", ["button", "submit", "reset"], "button"),
      styles("icon"),
    ],
    "Action button.",
    { type: "primary", children: "Submit" },
  ),
  ui(
    "Input",
    [
      str("placeholder"),
      str("value"),
      enumProp("size", SIZES, "middle"),
      str("type"),
      node("prefix"),
      node("suffix"),
      node("addonBefore"),
      node("addonAfter"),
      bool("allowClear"),
      bool("disabled"),
      bool("readOnly"),
      num("maxLength"),
      bool("showCount"),
      enumProp("status", STATUS),
      enumProp("variant", VARIANTS, "outlined"),
    ],
    undefined,
    { placeholder: "Email address" },
  ),
  ui(
    "Select",
    [
      str("placeholder"),
      json("value", "string | number | (string | number)[]"),
      json("options", "{ value: string; label: string }[]"),
      enumProp("size", SIZES, "middle"),
      enumProp("mode", ["multiple", "tags"]),
      bool("allowClear"),
      bool("disabled"),
      bool("loading"),
      bool("showSearch"),
      node("prefix"),
      node("suffixIcon"),
      json("maxTagCount", 'number | "responsive"'),
      enumProp("status", STATUS),
      enumProp("variant", VARIANTS, "outlined"),
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
  ui("Checkbox", [children, bool("checked"), bool("indeterminate"), bool("disabled")], undefined, {
    checked: true,
    children: "Remember me",
  }),
  ui(
    "Radio",
    [children, bool("checked"), bool("disabled"), json("value", "string | number")],
    undefined,
    { checked: true, children: "Monthly" },
  ),
  ui(
    "Switch",
    [
      bool("checked"),
      enumProp("size", ["default", "small"], "default"),
      bool("disabled"),
      bool("loading"),
      node("checkedChildren"),
      node("unCheckedChildren"),
    ],
    undefined,
    { checked: true },
  ),
  ui(
    "Segmented",
    [
      json("options", "(string | number | { label: ReactNode; value: string | number })[]"),
      json("value", "string | number"),
      enumProp("size", SIZES, "middle"),
      bool("block"),
      bool("disabled"),
      bool("vertical"),
      enumProp("shape", ["default", "round"], "default"),
    ],
    "Segmented control.",
    { options: ["Daily", "Weekly", "Monthly"], value: "Weekly" },
  ),
  ui(
    "Slider",
    [
      json("value", "number | [number, number]"),
      num("min"),
      num("max"),
      num("step"),
      bool("range"),
      json("marks", "Record<number, ReactNode>"),
      bool("dots"),
      bool("included"),
      bool("reverse"),
      bool("vertical"),
      bool("disabled"),
      styles("track tracks rail handle"),
    ],
    undefined,
    { value: 30 },
  ),
  ui(
    "Rate",
    [num("value"), num("count"), bool("allowHalf"), bool("disabled"), node("character")],
    "Star rating.",
    { value: 4 },
  ),

  // --- data ---
  ui(
    "Table",
    [
      json("columns", "{ title: string; dataIndex: string; key: string }[]"),
      json("dataSource", "Record<string, ReactNode>[] (each row needs a `key`)"),
      enumProp("size", ["large", "middle", "small"], "large"),
      json("pagination", "false | object"),
      bool("bordered"),
      bool("loading"),
      bool("showHeader"),
      str("rowKey"),
      json("scroll", "{ x?: number | string; y?: number | string }"),
      bool("sticky"),
      enumProp("tableLayout", ["auto", "fixed"]),
      json(
        "rowSelection",
        '{ type?: "checkbox" | "radio"; selectedRowKeys?: (string | number)[] }',
      ),
      node("caption"),
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
    [
      children,
      enumProp("size", ["default", "small", "large"], "default"),
      bool("bordered"),
      node("header"),
      node("footer"),
      bool("split"),
      enumProp("itemLayout", ["horizontal", "vertical"], "horizontal"),
      bool("loading"),
      json("grid", "{ gutter?: number; column?: number }"),
    ],
    "Compose with ListItem children (skip `dataSource`/`renderItem` — functions don't fit design JSON).",
    { bordered: true },
  ),
  sub(
    "List.Item",
    [children, node("extra"), json("actions", "ReactNode[]")],
    "One row inside a List — antd's List.Item.",
  ),
  sub(
    "List.Item.Meta",
    [node("title"), node("description"), node("avatar")],
    "Title/description/avatar layout inside a ListItem — antd's List.Item.Meta.",
    { title: "Deploy finished", description: "2 minutes ago" },
  ),
  ui(
    "Tabs",
    [
      json("items", "{ key: string; label: string; children?: ReactNode }[]"),
      str("activeKey"),
      enumProp("type", ["line", "card", "editable-card"], "line"),
      enumProp("size", SIZES, "middle"),
      bool("centered"),
      enumProp("tabPosition", ["top", "right", "bottom", "left"], "top"),
      node("tabBarExtraContent"),
      num("tabBarGutter"),
      css("tabBarStyle"),
    ],
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
    [
      num("current"),
      json("items", "{ title: string; description?: string }[]"),
      enumProp("direction", ["horizontal", "vertical"], "horizontal"),
      enumProp("size", ["default", "small"], "default"),
      enumProp("status", ["wait", "process", "finish", "error"], "process"),
      enumProp("type", ["default", "navigation", "inline"], "default"),
      enumProp("labelPlacement", ["horizontal", "vertical"], "horizontal"),
      bool("progressDot"),
      num("percent"),
      num("initial"),
    ],
    undefined,
    { current: 1, items: [{ title: "Build" }, { title: "Review" }, { title: "Ship" }] },
  ),
  ui("Breadcrumb", [json("items", "{ title: ReactNode }[]"), node("separator")], undefined, {
    items: [{ title: "Home" }, { title: "Reports" }],
  }),
  ui(
    "Pagination",
    [
      num("current"),
      num("total"),
      num("pageSize"),
      bool("simple"),
      enumProp("size", ["default", "small"], "default"),
      enumProp("align", ["start", "center", "end"], "start"),
      bool("showSizeChanger"),
      bool("showQuickJumper"),
      bool("showLessItems"),
      bool("hideOnSinglePage"),
      bool("disabled"),
    ],
    undefined,
    { current: 1, total: 50 },
  ),
  ui(
    "Menu",
    [
      json("items", "{ key: string; label: ReactNode; icon?: ReactNode }[]"),
      enumProp("mode", ["vertical", "horizontal", "inline"], "vertical"),
      json("selectedKeys", "string[]"),
      json("openKeys", "string[]"),
      enumProp("theme", ["light", "dark"], "light"),
      bool("inlineCollapsed"),
      num("inlineIndent"),
      bool("selectable"),
      bool("multiple"),
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
    [
      children,
      node("title"),
      json("width", "number | string"),
      node("footer"),
      bool("open"),
      bool("centered"),
      bool("closable"),
      node("okText"),
      node("cancelText"),
      enumProp("okType", ["primary", "default", "dashed", "text", "link"], "primary"),
      bool("confirmLoading"),
      bool("loading"),
      json("okButtonProps", "ButtonProps"),
      json("cancelButtonProps", "ButtonProps"),
      styles("header body footer content mask"),
    ],
    "Modal dialog surface — renders open + inline in design mode. Put the body in children; `footer` renders as a right-aligned action row.",
    { title: "Delete item?" },
  ),
  ui(
    "Drawer",
    [
      children,
      node("title"),
      node("extra"),
      node("footer"),
      bool("open"),
      enumProp("placement", ["top", "right", "bottom", "left"], "right"),
      enumProp("size", ["default", "large"], "default"),
      json("width", "number | string"),
      json("height", "number | string"),
      bool("closable"),
      bool("loading"),
      styles("header body footer content wrapper mask"),
    ],
    "A side panel — renders inline as a fixed-width column in design mode.",
    { title: "Filters" },
  ),
  ui(
    "Popover",
    [
      children,
      node("title"),
      node("content"),
      enumProp("placement", PLACEMENTS, "top"),
      bool("open"),
      json("arrow", "boolean | { pointAtCenter?: boolean }"),
      color("color"),
      styles("root body"),
    ],
    "A popover — the trigger child renders inline with the surface pinned open below it.",
    { title: "Details", content: "Popover body" },
  ),
  ui(
    "Tooltip",
    [
      children,
      node("title"),
      enumProp("placement", PLACEMENTS, "top"),
      bool("open"),
      json("arrow", "boolean | { pointAtCenter?: boolean }"),
      color("color"),
      styles("root body"),
    ],
    "The trigger child renders inline; `title` shows beside it as a dark pill in design mode.",
    { title: "Copy to clipboard" },
  ),
  ui(
    "Dropdown",
    [
      children,
      json("menu", "{ items: { key: string; label: ReactNode }[] }"),
      enumProp(
        "placement",
        ["bottomLeft", "bottom", "bottomRight", "topLeft", "top", "topRight"],
        "bottomLeft",
      ),
      bool("open"),
      json("arrow", "boolean | { pointAtCenter?: boolean }"),
      json("trigger", '("click" | "hover" | "contextMenu")[]'),
      bool("disabled"),
    ],
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
  helper(
    "Prose",
    [
      children,
      { name: "preset", type: "string", optional: true, control: "string" },
      { name: "as", type: "string", optional: true, control: "string" },
    ],
    "A long-form content region. Everything inside — Typography, headings, lists, quotes, code, tables — picks up the theme typeset's proportions and vertical rhythm automatically. `preset` selects a named typeset (see set_typeset). Reach for this for articles, docs, and marketing copy instead of setting sizes block by block.",
    { as: "article" },
  ),
];
