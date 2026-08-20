import type { Board, Screen } from "@velloo/schema";
import type { ScannedRoute } from "./types.ts";

/**
 * Placeholder tree for a generated screen. Renders a centered card
 * carrying the route path + a "designed by you" prompt — meant as a
 * starting point for the agent to fill in, not as a finished design.
 *
 * Uses only `Box` + `Heading` + `Text` + `Card` (+ `Badge`) — every ref here
 * is in both the shadcn provider and the no-library provider's registry, so a
 * scanned folder renders under either. Layout is plain flex on `Box` rather
 * than `Container`/`Stack` (which exist only in the no-lib provider). `Badge`
 * has no no-lib equivalent, so we substitute a Text node when `hasBadge` is
 * false.
 */
function buildPlaceholderTree(route: ScannedRoute, hasBadge: boolean): Screen["tree"] {
  return {
    $ref: "Box",
    props: { className: "mx-auto w-full max-w-4xl px-6 py-16" },
    children: [
      {
        $ref: "Box",
        props: { className: "flex flex-col items-center gap-6 text-center" },
        children: [
          hasBadge
            ? {
                $ref: "Badge",
                props: { variant: "outline", children: route.routePath },
              }
            : {
                $ref: "Text",
                props: { variant: "muted", children: route.routePath },
              },
          {
            $ref: "Heading",
            props: { level: 1, children: route.name },
          },
          {
            $ref: "Text",
            props: {
              variant: "lead",
              className: "max-w-xl",
              children: `This is a placeholder, generated from your app's route structure. Rebuild this screen in place — its id is already "${route.id}", so build into it with add_node / instantiate_snippet (don't add_screen — that conflicts). Start with the hero, then add the supporting sections.`,
            },
          },
          {
            $ref: "Card",
            props: { className: "mt-4 w-full max-w-2xl text-left" },
            children: [
              {
                $ref: "Box",
                props: { className: "flex flex-col gap-2 p-6" },
                children: [
                  {
                    $ref: "Text",
                    props: {
                      variant: "small",
                      className: "uppercase tracking-wider",
                      children: "Detected from",
                    },
                  },
                  {
                    $ref: "Text",
                    props: { className: "font-mono text-sm", children: route.sourceFile },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

interface BuildScreensOpts {
  routes: ScannedRoute[];
  /**
   * Whether the active provider supports `Badge` (shadcn yes, no-lib no).
   * When false, the placeholder tree uses a Text node instead of a Badge.
   */
  hasBadge: boolean;
}

export function buildScreensFromScan(opts: BuildScreensOpts): Screen[] {
  return opts.routes.map((route) => ({
    id: route.id,
    name: route.name,
    tree: buildPlaceholderTree(route, opts.hasBadge),
  }));
}

interface BuildBoardOpts {
  screens: Screen[];
  /** Frame width (default 1024). */
  frameWidth?: number;
  /** Frame height (default 720). */
  frameHeight?: number;
  /** Frames per row before wrapping. Default 3. */
  columns?: number;
  /** Horizontal gutter between frames. Default 80. */
  gutter?: number;
}

/**
 * Lay every scanned screen out in a regular grid on one board. The
 * grid is generated so the user opens the canvas to a wall of frames
 * matching their app's routes, ready for the agent to design.
 */
export function buildBoardFromScan(opts: BuildBoardOpts): Board {
  const w = opts.frameWidth ?? 1024;
  const h = opts.frameHeight ?? 720;
  const cols = opts.columns ?? 3;
  const gutter = opts.gutter ?? 80;
  return {
    id: "app",
    name: "App",
    frames: opts.screens.map((screen, i) => ({
      id: `f-${screen.id}`,
      screen: screen.id,
      x: 80 + (i % cols) * (w + gutter),
      y: 80 + Math.floor(i / cols) * (h + gutter),
      w,
      h,
      label: screen.name,
    })),
    groups: [],
  };
}
