import type { MenuProps } from "antd";
import { Card as AntCard, Menu as AntMenu } from "antd";
import {
  type CSSProperties,
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";

/**
 * Canvas-safe antd overlays. antd's Modal/Drawer/Popover/Tooltip/Dropdown
 * portal to `document.body` and, in SSR, render nothing at all (rc-util's
 * Portal is client-only — verified: `open` overlays SSR to an empty string).
 * In design mode we want them rendered **open + inline** (in normal flow, no
 * escaping portal, no fixed backdrop) so a screenshot shows their surface.
 * These shims render the overlay's *content* on an inline antd Card surface;
 * the open/anchor/transition machinery is dropped. Trigger-wrapping overlays
 * (Popover/Tooltip/Dropdown) render their child trigger inline, followed by
 * the pinned-open surface.
 *
 * Mirrors the MUI adapter's `overlays.ts` and the shadcn snapshot's
 * pinned-open overlay stance.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

/** Pass-through props every node carries — className for styling, data-node-path for canvas selection. */
function chrome(props: Props): { className?: string; "data-node-path"?: string } {
  return {
    className: typeof props.className === "string" ? props.className : undefined,
    "data-node-path": props["data-node-path"] as string | undefined,
  };
}

/** Merge the node's authored `style` (this provider's style channel) over the shim's base. */
function mergeStyle(baseStyle: CSSProperties, style: unknown): CSSProperties {
  return style && typeof style === "object" && !Array.isArray(style)
    ? { ...baseStyle, ...(style as CSSProperties) }
    : baseStyle;
}

const SURFACE_SHADOW = "0 6px 16px rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12)";

/** The modal surface, rendered inline (open, no portal/backdrop). `footer` renders as a right-aligned row. */
export function Modal(props: Props): ReactElement {
  const width = typeof props.width === "number" ? props.width : 520;
  const footer = props.footer as ReactNode | undefined;
  return createElement(
    AntCard,
    {
      ...chrome(props),
      title: props.title as ReactNode,
      style: mergeStyle(
        { width: "100%", maxWidth: width, margin: "16px auto", boxShadow: SURFACE_SHADOW },
        props.style,
      ),
    },
    props.children,
    footer
      ? createElement(
          "div",
          { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 } },
          footer,
        )
      : null,
  );
}

/** A side-drawer panel, rendered inline as a fixed-width column. */
export function Drawer(props: Props): ReactElement {
  return createElement(
    AntCard,
    {
      ...chrome(props),
      title: props.title as ReactNode,
      style: mergeStyle(
        { width: 320, height: "100%", borderRadius: 0, boxShadow: SURFACE_SHADOW },
        props.style,
      ),
    },
    props.children,
  );
}

/** The trigger child inline, followed by the popover surface (title + content), pinned open. */
export function Popover(props: Props): ReactElement {
  return createElement(
    Fragment,
    null,
    props.children,
    createElement(
      AntCard,
      {
        ...chrome(props),
        size: "small",
        title: props.title as ReactNode,
        style: mergeStyle(
          { display: "inline-block", maxWidth: 320, marginTop: 8, boxShadow: SURFACE_SHADOW },
          props.style,
        ),
      },
      props.content as ReactNode,
    ),
  );
}

/** The trigger child inline; `title` renders beside it as a dark tooltip pill. */
export function Tooltip(props: Props): ReactElement {
  const tip = props.title as ReactNode | undefined;
  return createElement(
    Fragment,
    null,
    props.children,
    tip == null
      ? null
      : createElement(
          "span",
          {
            ...chrome(props),
            style: mergeStyle(
              {
                display: "inline-block",
                background: "rgba(0, 0, 0, 0.85)",
                color: "#fff",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 12,
                lineHeight: 1.4,
                marginLeft: 8,
                verticalAlign: "middle",
              },
              props.style,
            ),
          },
          tip,
        ),
  );
}

/** The trigger child inline, followed by the dropdown's menu surface (from `menu.items`), pinned open. */
export function Dropdown(props: Props): ReactElement {
  const menu = props.menu as { items?: MenuProps["items"] } | undefined;
  return createElement(
    Fragment,
    null,
    props.children,
    createElement(
      "div",
      {
        ...chrome(props),
        style: mergeStyle(
          {
            display: "inline-block",
            minWidth: 160,
            marginTop: 4,
            borderRadius: 8,
            boxShadow: SURFACE_SHADOW,
            overflow: "hidden",
          },
          props.style,
        ),
      },
      createElement(AntMenu, {
        items: menu?.items ?? [],
        selectable: false,
        style: { borderInlineEnd: "none" },
      }),
    ),
  );
}
