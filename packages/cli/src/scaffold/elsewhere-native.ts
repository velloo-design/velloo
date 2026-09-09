import {
  type ComponentNode,
  isComponentNode,
  type Node,
  type Screen,
  type Snippet,
} from "@velloo/schema";
import { type Style, sampleStyle } from "./elsewhere-styles.ts";

export type NativeLibrary = "mui" | "antd" | "chakra" | "none";
const v = (name: string) => `var(--color-${name})`;
const surface: Style = {
  backgroundColor: v("card"),
  color: v("card-foreground"),
  border: `1px solid ${v("border")}`,
  borderRadius: "12px",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
  padding: "24px",
};
const textStyle: Style = {
  display: "block",
  margin: "0px",
  fontSize: "14px",
  lineHeight: 1.5,
  color: "inherit",
};
const helpers = new Set(["Image", "Icon", "SVG"]);
const containers = new Set([
  "Box",
  "Field",
  "FieldGroup",
  "InputGroup",
  "InputGroupAddon",
  "Message",
  "MessageAvatar",
  "MessageHeader",
  "MessageContent",
  "MessageGroup",
  "ButtonGroup",
  "CardContent",
  "TabsList",
  "AvatarFallback",
  "AlertTitle",
  "AlertDescription",
]);

/** Recreate the shared product with the selected library's actual components.
 * Composite controls are rebuilt as native families (not renamed shadcn parts).
 * The no-library choice uses the provider's plain React primitives. */
export function nativeElsewhere(
  library: NativeLibrary,
  screens: Screen[],
  snippets: Snippet[],
): { screens: Screen[]; snippets: Snippet[]; css: string } {
  let nextStyle = 0;
  const css: string[] = [
    "body { margin: 0; } [data-ew-root], [data-ew-root] * { box-sizing: border-box; }",
  ];
  const layout = library === "antd" ? "Flex" : "Box";
  const type = library === "mui" ? "Typography" : library === "antd" ? "TypographyText" : "Text";
  function styles(
    props: Record<string, unknown>,
    style: Style,
    helper = false,
  ): Record<string, unknown> {
    if ((library === "mui" || library === "chakra") && !helper) return { ...props, sx: style };
    const plain: Style = {};
    const nested: Style = {};
    for (const [k, val] of Object.entries(style)) {
      if (typeof val === "object") nested[k] = val;
      else plain[k] = val;
    }
    if (Object.keys(nested).length) {
      const id = `ew${++nextStyle}`;
      props["data-ew-style"] = id;
      const selector = `[data-ew-style="${id}"]`;
      for (const [key, val] of Object.entries(nested)) {
        css.push(rule(selector, key, val as Style));
      }
    }
    return { ...props, style: plain };
  }
  function rule(selector: string, key: string, s: Style): string {
    const declarations = Object.entries(s)
      .filter(([, val]) => typeof val !== "object")
      .map(([k, val]) => `${k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)}:${val} !important;`)
      .join("");
    const nested = Object.entries(s)
      .filter(([, val]) => typeof val === "object")
      .map(([k, val]) =>
        rule(key.startsWith("@") ? selector : key.replaceAll("&", selector), k, val as Style),
      )
      .join("");
    return key.startsWith("@")
      ? `${key}{${selector}{${declarations}}${nested}}`
      : `${key.replaceAll("&", selector)}{${declarations}}${nested}`;
  }
  const node = (ref: string, props: Record<string, unknown>, children?: Node[]): ComponentNode => ({
    $ref: ref,
    props,
    ...(children?.length ? { children } : {}),
  });
  function convert(input: Node): Node {
    if (!isComponentNode(input)) return structuredClone(input);
    const original = input.$ref;
    const p = { ...input.props };
    const klass = typeof p.className === "string" ? p.className : "";
    delete p.className;
    const authored = { ...sampleStyle(klass), ...((p.style as Style) ?? {}) };
    delete p.style;
    let style: Style = {};
    let ref = original;
    let children =
      ["Tabs", "Avatar", "NativeSelect", "ToggleGroup"].includes(original) ||
      (original === "Table" && library === "antd")
        ? undefined
        : input.children?.map(convert);
    if (original === "Text" || original === "Heading" || original === "FieldLabel") {
      const heading = original === "Heading";
      ref = heading
        ? library === "mui"
          ? "Typography"
          : library === "antd"
            ? "TypographyTitle"
            : "Heading"
        : type;
      style = {
        ...textStyle,
        ...(heading
          ? {
              fontFamily: "var(--font-display, Georgia, serif)",
              fontSize: "36px",
              fontWeight: 400,
              lineHeight: 1.15,
            }
          : {}),
        ...(original === "FieldLabel" ? { fontSize: "12px", fontWeight: 600 } : {}),
      };
      if (library === "mui") p.component = heading ? "h2" : "p";
      if (library === "antd" && heading) p.level = 2;
    } else if (original === "Button") {
      const variant = p.variant;
      style = {
        textTransform: "none",
        fontSize: "12px",
        minHeight: "36px",
        padding: "8px 16px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        whiteSpace: "nowrap",
        borderRadius: "9999px",
        boxShadow: "none",
        lineHeight: 1.4,
      };
      if (variant === "default" || variant === undefined)
        Object.assign(style, {
          backgroundColor: v("primary"),
          color: v("primary-foreground"),
          border: "1px solid transparent",
        });
      else if (variant === "secondary")
        Object.assign(style, {
          backgroundColor: v("secondary"),
          color: v("secondary-foreground"),
          border: "1px solid transparent",
        });
      else
        Object.assign(style, {
          backgroundColor: "transparent",
          color: v("foreground"),
          border: variant === "outline" ? `1px solid ${v("border")}` : "1px solid transparent",
        });
      if (library === "mui")
        p.variant = variant === "outline" ? "outlined" : variant === "ghost" ? "text" : "contained";
      if (library === "antd") {
        delete p.variant;
        p.type = variant === "ghost" ? "text" : variant === "default" ? "primary" : "default";
      }
      if (library === "chakra")
        p.variant = variant === "outline" ? "outline" : variant === "ghost" ? "ghost" : "solid";
      if (p.size === "icon") {
        delete p.size;
        Object.assign(style, { width: "32px", height: "32px", minWidth: "32px", padding: "0px" });
      }
      if (library === "none" && variant === "secondary") p.variant = "default";
    } else if (original === "Badge") {
      ref = library === "mui" ? "Chip" : library === "none" ? layout : "Tag";
      const label = p.children;
      delete p.variant;
      if (library === "mui") {
        delete p.children;
        p.label = label;
        p.size = "small";
      }
      style = {
        backgroundColor: v("secondary"),
        color: v("secondary-foreground"),
        border: "none",
        borderRadius: "9999px",
        fontSize: "10px",
        lineHeight: 1.5,
        padding: "3px 10px",
        display: "inline-flex",
        alignItems: "center",
        width: "fit-content",
        whiteSpace: "nowrap",
      };
    } else if (original === "Card") {
      style = { ...surface };
      if (library === "antd") {
        p.styles = { body: { display: "flex", flexDirection: "column", gap: "20px", padding: 0 } };
      }
    } else if (original === "Avatar") {
      const fallback = input.children?.find(
        (c) => isComponentNode(c) && c.$ref === "AvatarFallback",
      );
      const label = fallback && isComponentNode(fallback) ? fallback.props?.children : "";
      children = undefined;
      p.children = label;
      style = {
        width: "32px",
        height: "32px",
        borderRadius: "50%",
        backgroundColor: v("secondary"),
        color: v("secondary-foreground"),
        fontSize: "10px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      };
      if (library === "none") ref = layout;
      if (library === "chakra") {
        p.name = label;
        delete p.children;
      }
    } else if (original === "Image") {
      p.fill = false;
      style = { display: "block", objectFit: "cover" };
      if (klass.includes("ew-route-map"))
        style["@media (max-width: 767px)"] = { objectFit: "contain", backgroundColor: "#EDEFE4" };
    } else if (original === "Icon") {
      style = { width: "16px", height: "16px", flexShrink: 0 };
    } else if (original === "SVG") {
      style = { display: "inline-block" };
    } else if (original === "Chart") {
      ref = "SVG";
      const rendered = chartSvg(p);
      for (const key of Object.keys(p)) delete p[key];
      Object.assign(p, rendered, { role: "img", "aria-label": rendered.label });
      delete p.label;
      style = { width: "100%", height: "200px", display: "block" };
    } else if (original === "Tabs") {
      const list = input.children?.find((c) => isComponentNode(c) && c.$ref === "TabsList");
      const triggers = list && isComponentNode(list) ? (list.children ?? []) : [];
      const active = p.defaultValue;
      if (library === "mui") {
        p.value = active;
        children = triggers.filter(isComponentNode).map((c) =>
          node("Tab", {
            label: c.props?.children,
            value: c.props?.value,
            sx: {
              fontSize: "12px",
              textTransform: "none",
              minWidth: "auto",
              padding: "12px 16px",
            },
          }),
        );
      } else if (library === "antd") {
        p.defaultActiveKey = active;
        p.items = triggers
          .filter(isComponentNode)
          .map((c) => ({ key: c.props?.value, label: c.props?.children }));
        children = undefined;
      } else if (library === "chakra") {
        p.defaultIndex = triggers.findIndex((c) => isComponentNode(c) && c.props?.value === active);
        children = [
          node(
            "TabList",
            {},
            triggers
              .filter(isComponentNode)
              .map((c) => node("Tab", { children: c.props?.children, sx: { fontSize: "12px" } })),
          ),
        ];
      } else {
        ref = layout;
        style = { display: "flex", gap: "20px", borderBottom: `1px solid ${v("border")}` };
        children = triggers.filter(isComponentNode).map((c) =>
          node("Button", {
            children: c.props?.children,
            variant: "ghost",
            style: {
              fontSize: "12px",
              backgroundColor: "transparent",
              color: v("foreground"),
              border: 0,
              padding: "12px 16px",
              borderRadius: 0,
              borderBottom: c.props?.value === active ? `2px solid ${v("primary")}` : "none",
            },
          }),
        );
      }
      delete p.defaultValue;
    } else if (original === "ToggleGroup") {
      ref = layout;
      style = { display: "flex", justifyContent: "space-between", gap: "8px" };
      const active = p.defaultValue;
      delete p.type;
      delete p.defaultValue;
      children = input.children?.filter(isComponentNode).map((c) =>
        convert({
          ...c,
          $ref: "Button",
          props: { ...c.props, variant: c.props?.value === active ? "secondary" : "ghost" },
        }),
      );
    } else if (original === "NativeSelect") {
      const options =
        input.children
          ?.filter(isComponentNode)
          .map((c) => ({ value: c.props?.value, label: c.props?.children })) ?? [];
      const selected = p.defaultValue;
      delete p.defaultValue;
      style = { width: "100%", fontSize: "12px" };
      if (library === "mui") {
        ref = "Select";
        p.value = selected;
        p.size = "small";
        children = options.map((o) => node("MenuItem", { value: o.value, children: o.label }));
      } else if (library === "antd") {
        ref = "Select";
        p.defaultValue = selected;
        p.options = options;
        children = undefined;
      } else if (library === "chakra") {
        ref = "Select";
        p.defaultValue = selected;
        children = options.map((o) =>
          node("Box", { as: "option", value: o.value, children: o.label }),
        );
      } else {
        ref = "Input";
        p.defaultValue = options.find((o) => o.value === selected)?.label;
        p.readOnly = true;
        children = undefined;
      }
    } else if (original === "NativeSelectOption") {
      ref = layout;
    } else if (original === "Input" || original === "InputGroupInput" || original === "Textarea") {
      ref =
        library === "mui"
          ? "TextField"
          : original === "Textarea" && library === "chakra"
            ? "Textarea"
            : "Input";
      style = {
        width: "100%",
        minWidth: "0px",
        fontSize: "12px",
        color: v("foreground"),
        backgroundColor: v("card"),
      };
      if (library === "mui") {
        p.size = "small";
        p.fullWidth = true;
        style["& .MuiInputBase-root"] = { fontSize: "inherit", color: "inherit" };
        if (original === "InputGroupInput") style["& fieldset"] = { border: 0 };
        if (original === "Textarea") {
          p.multiline = true;
          p.minRows = 3;
        }
      }
      if (library === "antd" && original === "Textarea") {
        /* Antd's adapter exposes Input, not Input.TextArea. */ ref = layout;
        p.children = p.defaultValue ?? p.placeholder;
        delete p.defaultValue;
        delete p.placeholder;
        Object.assign(style, {
          border: `1px solid ${v("border")}`,
          borderRadius: "8px",
          minHeight: "90px",
          padding: "12px",
        });
      }
      if (library === "none" && original === "Textarea") {
        ref = layout;
        p.children = p.defaultValue ?? p.placeholder;
        delete p.defaultValue;
        delete p.placeholder;
        Object.assign(style, {
          border: `1px solid ${v("border")}`,
          borderRadius: "8px",
          minHeight: "90px",
          padding: "12px",
        });
      }
      if (original === "InputGroupInput")
        Object.assign(style, { flex: 1, border: 0, backgroundColor: "transparent" });
    } else if (original === "Progress") {
      if (library === "mui") {
        ref = "LinearProgress";
        p.variant = "determinate";
      } else if (library === "antd") {
        p.percent = p.value;
        delete p.value;
        p.showInfo = false;
      } else if (library === "none") {
        ref = layout;
        children = [
          node(layout, {
            style: { width: `${p.value}%`, height: "100%", backgroundColor: v("primary") },
          }),
        ];
        delete p.value;
      }
      style = {
        width: "100%",
        height: "8px",
        borderRadius: "9999px",
        overflow: "hidden",
        backgroundColor: v("muted"),
      };
    } else if (original === "Separator") {
      ref = library === "none" ? layout : "Divider";
      style = { border: 0, borderTop: `1px solid ${v("border")}`, margin: 0, width: "100%" };
    } else if (original === "Switch") {
      if (library === "chakra") {
        p.defaultChecked = undefined;
        p.isChecked = true;
      }
      if (library === "none") {
        ref = "Input";
        p.type = "checkbox";
      }
    } else if (original === "Table" && library === "antd") {
      const header = input.children?.find((c) => isComponentNode(c) && c.$ref === "TableHeader");
      const body = input.children?.find((c) => isComponentNode(c) && c.$ref === "TableBody");
      const cells = header && isComponentNode(header) && header.children?.[0];
      p.columns = isComponentNode(cells as Node)
        ? (cells as ComponentNode).children?.map((c, i) => ({
            title: plainText(c),
            dataIndex: `c${i}`,
            key: `c${i}`,
          }))
        : [];
      p.dataSource =
        body && isComponentNode(body)
          ? body.children?.map((row, i) => ({
              key: i,
              ...Object.fromEntries(
                (isComponentNode(row) ? (row.children ?? []) : []).map((cell, j) => [
                  `c${j}`,
                  plainText(cell),
                ]),
              ),
            }))
          : [];
      p.pagination = false;
      p.size = "small";
      children = undefined;
    } else if (original.startsWith("Table")) {
      const mappings: Record<string, string> =
        library === "mui"
          ? {
              Table: "Table",
              TableHeader: "TableHead",
              TableHead: "TableCell",
              TableBody: "TableBody",
              TableRow: "TableRow",
              TableCell: "TableCell",
            }
          : library === "chakra"
            ? {
                Table: "Table",
                TableHeader: "Thead",
                TableHead: "Th",
                TableBody: "Tbody",
                TableRow: "Tr",
                TableCell: "Td",
              }
            : {};
      ref = mappings[original] ?? layout;
      if (library === "none" || library === "antd") {
        style =
          original === "TableRow"
            ? {
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                borderBottom: `1px solid ${v("border")}`,
              }
            : { display: "block", width: "100%" };
      }
      if (original === "TableHead" || original === "TableCell")
        Object.assign(style, {
          fontSize: "12px",
          padding: "16px 8px",
          borderColor: v("border"),
          color: "inherit",
          textAlign: "left",
          textTransform: "none",
        });
    } else if (original === "Alert") {
      if (library === "none") ref = layout;
      if (library === "antd") {
        const title = input.children?.find((c) => isComponentNode(c) && c.$ref === "AlertTitle");
        const desc = input.children?.find(
          (c) => isComponentNode(c) && c.$ref === "AlertDescription",
        );
        p.message = title ? plainText(title) : "";
        p.description = desc ? plainText(desc) : "";
        p.type = "info";
        p.showIcon = true;
        children = undefined;
      }
      if (library === "mui") p.severity = "success";
      if (library === "chakra") p.status = "success";
      style = {
        padding: "16px",
        border: `1px solid ${v("border")}`,
        borderRadius: "12px",
        fontSize: "12px",
      };
    } else if (containers.has(original)) {
      ref = layout;
      style = { display: "block" };
      if (original === "Box" && library === "antd") style.display = "block";
      if (original === "Field" || original === "FieldGroup") {
        style = {
          display: "flex",
          flexDirection: "column",
          gap: original === "Field" ? "8px" : "20px",
        };
      }
      if (original === "InputGroup")
        style = {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          border: `1px solid ${v("border")}`,
          borderRadius: "8px",
          minHeight: "36px",
          padding: "0px 8px",
        };
      if (original === "InputGroupAddon")
        style = { display: "flex", alignItems: "center", flexShrink: 0 };
      if (original === "Message") {
        style = { display: "flex", gap: "12px", alignItems: "flex-start" };
        if (p.align === "end") style.flexDirection = "row-reverse";
        delete p.align;
      }
      if (original === "ButtonGroup") style = { display: "flex" };
      if (original === "AlertTitle") style = { fontSize: "12px", fontWeight: 600 };
      if (original === "AlertDescription") style = { fontSize: "12px", lineHeight: 1.6 };
      if (p.as && library === "mui") {
        p.component = p.as;
        delete p.as;
      }
      if (p.as && library === "antd") {
        p.component = p.as;
        delete p.as;
      }
      if (library === "none") delete p.as;
    } else throw new Error(`Elsewhere: no ${library} composition for ${original}`);
    const merged = { ...style, ...authored };
    if (input.$id?.endsWith("-1")) p["data-ew-root"] = "";
    return {
      ...node(ref, styles(p, merged, helpers.has(ref)), children),
      ...(input.$id ? { $id: input.$id } : {}),
    };
  }
  return {
    screens: screens.map((s) => ({ ...s, tree: convert(s.tree) })),
    snippets: snippets.map((s) => ({ ...s, tree: convert(s.tree) })),
    css: css.join("\n"),
  };
}
function plainText(n: Node): string {
  if (!isComponentNode(n)) return "";
  return typeof n.props?.children === "string"
    ? n.props.children
    : (n.children ?? []).map(plainText).join(" ");
}
/** Framework-neutral SVG chart: these adapters do not expose a chart library.
 * Values and labels remain editable inputs in the canonical design. */
function chartSvg(p: Record<string, unknown>): Record<string, unknown> {
  const categories = (p.categories as string[]) ?? [];
  const series = (p.series as { name?: string; data: number[] }[]) ?? [];
  const values = series[0]?.data ?? [];
  const max = Math.max(...values, 1) * 1.15;
  const w = 560,
    h = 210,
    left = 45,
    plot = 480,
    baseline = 175;
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  let content = `<text x="10" y="15" font-size="10" fill="${v("muted-foreground")}">${esc(String(p.yLabel ?? ""))}</text>`;
  for (let k = 0; k <= 4; k++) {
    const y = baseline - k * 38;
    content += `<path d="M${left} ${y}H540" stroke="${v("border")}"/><text x="35" y="${y + 3}" text-anchor="end" font-size="9" fill="${v("muted-foreground")}">${Math.round((max * k) / 4)}</text>`;
  }
  const points: [number, number][] = values.map((val, i) => [
    left + (plot * (i + 0.5)) / values.length,
    baseline - (val / max) * 152,
  ]);
  if (p.kind === "bar")
    points.forEach(([x, y], i) => {
      content += `<rect x="${x - 22}" y="${y}" width="44" height="${baseline - y}" rx="3" fill="${v("primary")}"/><title>${esc(categories[i] ?? "")}: ${values[i]}</title>`;
    });
  else
    content += `<polyline points="${points.map((a) => a.join(",")).join(" ")}" fill="none" stroke="${v("primary")}" stroke-width="2"/>`;
  categories.forEach((label, i) => {
    content += `<text x="${points[i]?.[0]}" y="200" text-anchor="middle" font-size="10" fill="${v("muted-foreground")}">${esc(label)}</text>`;
  });
  return { viewBox: `0 0 ${w} ${h}`, content, label: series[0]?.name ?? "Trip chart" };
}
