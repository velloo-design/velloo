import {
  Box,
  Button as ChakraButton,
  Divider as ChakraDivider,
  CloseButton,
} from "@chakra-ui/react";
import { createElement, Fragment, type ReactElement, type ReactNode } from "react";

/**
 * Canvas-safe chakra overlays. Chakra's Modal/Drawer portal to `document.body`
 * and render NOTHING in SSR (their Portal is client-only), and every overlay
 * sub-part (ModalHeader, MenuList, PopoverContent, …) reads a context the real
 * parent provides — standalone they throw. Unlike MUI (whose Dialog parts are
 * context-free and re-exported real), chakra needs the WHOLE composition
 * shimmed. The shims keep chakra's composition ids so `emit_code` output is
 * idiomatic chakra (`<Modal><ModalContent>…`), but render everything **open +
 * inline** (in normal flow, no escaping portal, no fixed backdrop) so a
 * screenshot shows the surface; the open/anchor/transition machinery is
 * dropped and the pure-chrome parts (overlay backdrops, popover arrow) render
 * nothing.
 *
 * Mirrors the MUI/antd adapters' overlays and the shadcn snapshot's
 * pinned-open overlay stance.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

/** Pass-through props every node carries — className for styling, data-node-path for canvas selection. */
function chrome(props: Props): { className?: string; "data-node-path"?: string } {
  // Only the keys that are actually present: the return type says these may be
  // *absent*, and under `exactOptionalPropertyTypes` an explicit `undefined` is
  // a different thing from an omitted key.
  const className = typeof props.className === "string" ? props.className : undefined;
  const nodePath = props["data-node-path"];
  return {
    ...(className !== undefined ? { className } : {}),
    ...(typeof nodePath === "string" ? { "data-node-path": nodePath } : {}),
  };
}

/** Merge the node's authored `sx` (this provider's style channel) over the shim's base. */
function mergeSx(baseSx: Record<string, unknown>, sx: unknown): Record<string, unknown> {
  return sx && typeof sx === "object" && !Array.isArray(sx)
    ? { ...baseSx, ...(sx as Record<string, unknown>) }
    : baseSx;
}

function surface(props: Props, baseSx: Record<string, unknown>): ReactElement {
  return createElement(Box, { ...chrome(props), sx: mergeSx(baseSx, props.sx) }, props.children);
}

/** A part that exists only for chakra-composition compatibility (backdrops, arrows) — renders nothing. */
function nothing(): null {
  return null;
}

// --- Modal ---

/** Chakra's modal `size` → a maxW token for the inline surface. */
const MODAL_MAX_W: Record<string, string> = {
  xs: "xs",
  sm: "sm",
  md: "md",
  lg: "lg",
  xl: "xl",
  "2xl": "2xl",
  full: "100%",
};

/** The modal positioning wrapper, rendered inline (open, no portal). */
export function Modal(props: Props): ReactElement {
  const maxW = typeof props.size === "string" ? (MODAL_MAX_W[props.size] ?? "md") : "md";
  return surface(props, { w: "100%", maxW, mx: "auto", my: 4 });
}

export const ModalOverlay = nothing;

/** The modal surface card. */
export function ModalContent(props: Props): ReactElement {
  return surface(props, {
    bg: "chakra-body-bg",
    borderRadius: "md",
    boxShadow: "lg",
    overflow: "hidden",
    position: "relative",
  });
}

export function ModalHeader(props: Props): ReactElement {
  return surface(props, { px: 6, py: 4, fontSize: "xl", fontWeight: "semibold" });
}

export function ModalBody(props: Props): ReactElement {
  return surface(props, { px: 6, py: 2 });
}

export function ModalFooter(props: Props): ReactElement {
  return surface(props, { display: "flex", justifyContent: "flex-end", gap: 3, px: 6, py: 4 });
}

/** Chakra's real CloseButton is context-free — pin it where the modal puts it. */
export function ModalCloseButton(props: Props): ReactElement {
  return createElement(CloseButton, {
    ...chrome(props),
    sx: mergeSx({ position: "absolute", top: 2, insetEnd: 3 }, props.sx),
  });
}

// --- Drawer ---

/** A side-drawer panel, rendered inline as a fixed-width column. */
export function Drawer(props: Props): ReactElement {
  return surface(props, { w: "320px", maxW: "100%", h: "100%" });
}

export const DrawerOverlay = nothing;

export function DrawerContent(props: Props): ReactElement {
  return surface(props, {
    bg: "chakra-body-bg",
    h: "100%",
    boxShadow: "lg",
    display: "flex",
    flexDirection: "column",
  });
}

export function DrawerHeader(props: Props): ReactElement {
  return surface(props, { px: 6, py: 4, fontSize: "xl", fontWeight: "semibold" });
}

export function DrawerBody(props: Props): ReactElement {
  return surface(props, { px: 6, py: 2, flex: "1" });
}

export function DrawerFooter(props: Props): ReactElement {
  return surface(props, { display: "flex", justifyContent: "flex-end", gap: 3, px: 6, py: 4 });
}

// --- Popover ---

/** The trigger renders inline, the content pinned open below it. */
export function Popover(props: Props): ReactElement {
  return surface(props, { display: "inline-block" });
}

/** The trigger child as-is (selection lands on the child). */
export function PopoverTrigger(props: Props): ReactElement {
  return createElement(Fragment, null, props.children);
}

export function PopoverContent(props: Props): ReactElement {
  return surface(props, {
    w: "xs",
    mt: 2,
    bg: "chakra-body-bg",
    borderWidth: "1px",
    borderColor: "chakra-border-color",
    borderRadius: "md",
    boxShadow: "lg",
  });
}

export function PopoverHeader(props: Props): ReactElement {
  return surface(props, { px: 3, py: 2, borderBottomWidth: "1px", fontWeight: "medium" });
}

export function PopoverBody(props: Props): ReactElement {
  return surface(props, { px: 3, py: 2 });
}

export const PopoverArrow = nothing;

// --- Menu ---

/** The trigger renders inline with the menu surface pinned open below it. */
export function Menu(props: Props): ReactElement {
  return surface(props, { display: "inline-block" });
}

/** Chakra's real MenuButton needs menu context — a chakra Button stands in. */
export function MenuButton(props: Props): ReactElement {
  return createElement(
    ChakraButton,
    { ...chrome(props), variant: "outline", sx: mergeSx({}, props.sx) },
    props.children,
  );
}

export function MenuList(props: Props): ReactElement {
  return surface(props, {
    minW: "3xs",
    mt: 2,
    py: 2,
    bg: "chakra-body-bg",
    borderWidth: "1px",
    borderColor: "chakra-border-color",
    borderRadius: "md",
    boxShadow: "lg",
  });
}

export function MenuItem(props: Props): ReactElement {
  return surface(props, { display: "flex", alignItems: "center", gap: 2, px: 3, py: 1.5 });
}

export function MenuDivider(props: Props): ReactElement {
  return createElement(ChakraDivider, { ...chrome(props), sx: mergeSx({ my: 2 }, props.sx) });
}

// --- Tooltip ---

/** The trigger child inline; `label` renders beside it as a dark tooltip pill. */
export function Tooltip(props: Props): ReactElement {
  const label = props.label as ReactNode | undefined;
  return createElement(
    Fragment,
    null,
    props.children,
    label == null
      ? null
      : createElement(
          Box,
          {
            as: "span",
            ...chrome(props),
            sx: mergeSx(
              {
                display: "inline-block",
                bg: "gray.700",
                color: "white",
                borderRadius: "sm",
                px: 2,
                py: 1,
                fontSize: "sm",
                lineHeight: "shorter",
                ml: 2,
                verticalAlign: "middle",
              },
              props.sx,
            ),
          },
          label,
        ),
  );
}
