import Box from "@mui/material/Box";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import { createElement, type ReactElement, type ReactNode } from "react";

/**
 * Canvas-safe MUI overlays. MUI's Dialog/Menu/Popover/Drawer/Snackbar portal to
 * `document.body` and default to closed — in design mode we want them rendered
 * **open + inline** (in normal flow, no escaping portal, no fixed backdrop) so a
 * screenshot shows their surface. These shims render the overlay's *content* in
 * a Paper inline; the open/anchor/transition machinery is dropped. The
 * sub-parts (DialogTitle/Content/Actions) are MUI's real components — they're
 * plain styled boxes that already render inline — re-exported as-is.
 *
 * Mirrors the shadcn snapshot's pinned-open overlay stance.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

/** Pass-through props every node carries — className for styling, data-node-path for canvas selection. */
function chrome(props: Props): { className?: string; "data-node-path"?: string } {
  return {
    className: typeof props.className === "string" ? props.className : undefined,
    "data-node-path": props["data-node-path"] as string | undefined,
  };
}

function mergeSx(base: Record<string, unknown>, sx: unknown): Record<string, unknown> {
  return sx && typeof sx === "object" && !Array.isArray(sx) ? { ...base, ...sx } : base;
}

const DIALOG_WIDTH: Record<string, number> = { xs: 360, sm: 480, md: 600, lg: 800, xl: 960 };

/** The dialog surface, rendered inline (open, no portal/backdrop). */
export function Dialog(props: Props): ReactElement {
  const width = typeof props.maxWidth === "string" ? (DIALOG_WIDTH[props.maxWidth] ?? 600) : 600;
  return createElement(
    Paper,
    {
      ...chrome(props),
      elevation: 8,
      sx: mergeSx(
        { width: "100%", maxWidth: width, mx: "auto", my: 2, borderRadius: 2, overflow: "hidden" },
        props.sx,
      ),
    },
    props.children,
  );
}

/** A menu surface (a Paper holding MenuItems), rendered inline. */
export function Menu(props: Props): ReactElement {
  return createElement(
    Paper,
    {
      ...chrome(props),
      elevation: 3,
      sx: mergeSx({ display: "inline-block", minWidth: 180, py: 1, borderRadius: 1.5 }, props.sx),
    },
    props.children,
  );
}

/** A popover surface, rendered inline. */
export function Popover(props: Props): ReactElement {
  return createElement(
    Paper,
    {
      ...chrome(props),
      elevation: 3,
      sx: mergeSx({ display: "inline-block", p: 2, borderRadius: 1.5 }, props.sx),
    },
    props.children,
  );
}

/** A side-drawer panel, rendered inline as a fixed-width column. */
export function Drawer(props: Props): ReactElement {
  return createElement(
    Paper,
    {
      ...chrome(props),
      elevation: 2,
      square: true,
      sx: mergeSx({ width: 280, height: "100%", p: 2 }, props.sx),
    },
    props.children,
  );
}

/** A toast, rendered inline as a dark pill. `message` or children. */
export function Snackbar(props: Props): ReactElement {
  const body = props.message !== undefined ? (props.message as ReactNode) : props.children;
  return createElement(
    Box,
    {
      ...chrome(props),
      sx: mergeSx(
        {
          display: "inline-flex",
          alignItems: "center",
          px: 2,
          py: 1.25,
          bgcolor: "grey.900",
          color: "common.white",
          borderRadius: 1,
          fontSize: 14,
        },
        props.sx,
      ),
    },
    body,
  );
}

export { DialogActions, DialogContent, DialogContentText, DialogTitle };
