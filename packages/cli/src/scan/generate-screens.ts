import type { Board, BoardGroup, Frame, Screen } from "@velloo/schema";
import { idFromRoutePath, titleCaseFromSegment } from "./route-names.ts";
import { appSlug } from "./scan-apps.ts";
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

/**
 * MUI placeholder tree — the MUI registry has no `Heading`/`Text`/`Badge`
 * (it's `Typography`), so the shadcn/no-lib placeholder above won't resolve on
 * a MUI folder. Uses only Container / Stack / Typography / Card / CardContent +
 * `sx`, all in the MUI registry.
 */
function buildMuiPlaceholderTree(route: ScannedRoute): Screen["tree"] {
  return {
    $ref: "Container",
    props: { maxWidth: "md", sx: { py: 8 } },
    children: [
      {
        $ref: "Stack",
        props: { spacing: 3, sx: { alignItems: "center", textAlign: "center" } },
        children: [
          {
            $ref: "Typography",
            props: { variant: "overline", color: "text.secondary", children: route.routePath },
          },
          { $ref: "Typography", props: { variant: "h3", children: route.name } },
          {
            $ref: "Typography",
            props: {
              variant: "body1",
              color: "text.secondary",
              sx: { maxWidth: 520 },
              children: `This is a placeholder, generated from your app's route structure. Rebuild this screen in place — its id is already "${route.id}", so build into it with add_node / instantiate_snippet (don't add_screen — that conflicts). Start with the hero, then add the supporting sections.`,
            },
          },
          {
            $ref: "Card",
            props: { variant: "outlined", sx: { mt: 2, width: "100%", textAlign: "left" } },
            children: [
              {
                $ref: "CardContent",
                children: [
                  {
                    $ref: "Stack",
                    props: { spacing: 1 },
                    children: [
                      {
                        $ref: "Typography",
                        props: {
                          variant: "caption",
                          color: "text.secondary",
                          children: "Detected from",
                        },
                      },
                      {
                        $ref: "Typography",
                        props: {
                          variant: "body2",
                          sx: { fontFamily: "monospace" },
                          children: route.sourceFile,
                        },
                      },
                    ],
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

/**
 * antd placeholder tree — the antd registry has no `Heading`/`Text`/`Badge`
 * (it's `TypographyTitle`/`TypographyText`/`Tag`), so the shadcn/no-lib
 * placeholder above won't resolve on an antd folder. Uses only Flex /
 * Typography* / Tag / Card + inline `style`, all in the antd registry.
 */
function buildAntdPlaceholderTree(route: ScannedRoute): Screen["tree"] {
  return {
    $ref: "Flex",
    props: {
      vertical: true,
      align: "center",
      gap: "large",
      style: { padding: "64px 24px", textAlign: "center" },
    },
    children: [
      { $ref: "Tag", props: { children: route.routePath } },
      { $ref: "TypographyTitle", props: { level: 2, children: route.name } },
      {
        $ref: "TypographyParagraph",
        props: {
          type: "secondary",
          style: { maxWidth: 520 },
          children: `This is a placeholder, generated from your app's route structure. Rebuild this screen in place — its id is already "${route.id}", so build into it with add_node / instantiate_snippet (don't add_screen — that conflicts). Start with the hero, then add the supporting sections.`,
        },
      },
      {
        $ref: "Card",
        props: {
          title: "Detected from",
          style: { width: "100%", maxWidth: 640, textAlign: "left", marginTop: 16 },
        },
        children: [
          {
            $ref: "TypographyText",
            props: { code: true, children: route.sourceFile },
          },
        ],
      },
    ],
  };
}

/**
 * Chakra placeholder tree — chakra shares the shadcn ids (`Heading`/`Text`/
 * `Badge`/`Card`) but not the Tailwind `className` channel, so the shadcn
 * placeholder's classes would be inert. Uses only Container / Stack / Badge /
 * Heading / Text / Card / CardBody + `sx`, all in the chakra registry.
 */
function buildChakraPlaceholderTree(route: ScannedRoute): Screen["tree"] {
  return {
    $ref: "Container",
    props: { maxW: "4xl", sx: { py: 16 } },
    children: [
      {
        $ref: "Stack",
        props: { spacing: 6, sx: { alignItems: "center", textAlign: "center" } },
        children: [
          { $ref: "Badge", props: { variant: "outline", children: route.routePath } },
          { $ref: "Heading", props: { size: "xl", children: route.name } },
          {
            $ref: "Text",
            props: {
              sx: { maxW: "xl", color: "chakra-subtle-text" },
              children: `This is a placeholder, generated from your app's route structure. Rebuild this screen in place — its id is already "${route.id}", so build into it with add_node / instantiate_snippet (don't add_screen — that conflicts). Start with the hero, then add the supporting sections.`,
            },
          },
          {
            $ref: "Card",
            props: { variant: "outline", sx: { mt: 2, w: "100%", textAlign: "left" } },
            children: [
              {
                $ref: "CardBody",
                children: [
                  {
                    $ref: "Stack",
                    props: { spacing: 1 },
                    children: [
                      {
                        $ref: "Text",
                        props: {
                          sx: {
                            fontSize: "xs",
                            textTransform: "uppercase",
                            letterSpacing: "wider",
                            color: "chakra-subtle-text",
                          },
                          children: "Detected from",
                        },
                      },
                      {
                        $ref: "Text",
                        props: {
                          sx: { fontFamily: "mono", fontSize: "sm" },
                          children: route.sourceFile,
                        },
                      },
                    ],
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
  /**
   * Framework-native folder ⇒ emit that framework's placeholder
   * (MUI: Typography + sx; antd: TypographyTitle/Tag + inline style; chakra:
   * Heading/Text + sx) instead of the shadcn/no-lib one. Absent ⇒ the shared
   * Box/Heading/Text placeholder.
   */
  tree?: "mui" | "antd" | "chakra";
}

export function buildScreensFromScan(opts: BuildScreensOpts): Screen[] {
  const buildTree = (route: ScannedRoute): Screen["tree"] => {
    if (opts.tree === "mui") return buildMuiPlaceholderTree(route);
    if (opts.tree === "antd") return buildAntdPlaceholderTree(route);
    if (opts.tree === "chakra") return buildChakraPlaceholderTree(route);
    return buildPlaceholderTree(route, opts.hasBadge);
  };
  return opts.routes.map((route) => ({
    id: route.id,
    name: route.name,
    tree: buildTree(route),
  }));
}

interface BuildBoardsOpts {
  routes: ScannedRoute[];
  /** Desktop frame width (default 1024). */
  frameWidth?: number;
  /** Desktop frame height (default 720). */
  frameHeight?: number;
  /** Screens per row before wrapping. Default 3. */
  columns?: number;
  /** Horizontal gutter between screens. Default 80. */
  gutter?: number;
}

interface BoardDims {
  w: number;
  h: number;
  cols: number;
  gutter: number;
}

/**
 * Every scanned screen gets a mobile frame beside its desktop one (same
 * screen — edits sync), so responsive checking is set up from the first
 * render instead of being a handoff-prompt chore. 390×844 ≈ current iPhone.
 */
const MOBILE = { w: 390, h: 844, gap: 40 };

/** Top-level route segment ("" for the root page) — the grouping key. */
function sectionOf(routePath: string): string {
  return routePath.split("/").filter(Boolean)[0] ?? "";
}

/**
 * Lay one app's scanned routes out on a board. Few routes → the historical
 * flat grid. Enough routes with repeated top-level sections ("/settings/*",
 * "/blog/*") → one horizontal band per section, each multi-route section
 * wrapped in a BoardGroup so the canvas opens to an organized wall instead
 * of an undifferentiated grid. Single-route sections share a leading band.
 */
function buildAppBoard(id: string, name: string, routes: ScannedRoute[], dims: BoardDims): Board {
  const { w, h, cols, gutter } = dims;
  const cellW = w + MOBILE.gap + MOBILE.w;
  const rowH = Math.max(h, MOBILE.h) + gutter;
  const gridFrames = (rs: ScannedRoute[], startY: number, group?: string): Frame[] =>
    rs.flatMap((route, i) => {
      const x = 80 + (i % cols) * (cellW + gutter);
      const y = startY + Math.floor(i / cols) * rowH;
      return [
        {
          id: `f-${route.id}`,
          screen: route.id,
          x,
          y,
          w,
          h,
          label: route.name,
          ...(group ? { group } : {}),
        },
        {
          id: `f-${route.id}-m`,
          screen: route.id,
          x: x + w + MOBILE.gap,
          y,
          w: MOBILE.w,
          h: MOBILE.h,
          label: `${route.name} · Mobile`,
          ...(group ? { group } : {}),
        },
      ];
    });
  const bandHeight = (count: number) => Math.ceil(count / cols) * rowH;

  const sections = new Map<string, ScannedRoute[]>();
  for (const route of routes) {
    const key = sectionOf(route.routePath);
    const list = sections.get(key);
    if (list) list.push(route);
    else sections.set(key, [route]);
  }
  const multi = [...sections.entries()].filter(([key, rs]) => key !== "" && rs.length >= 2);

  if (routes.length < 5 || multi.length === 0) {
    return { id, name, frames: gridFrames(routes, 80), groups: [] };
  }

  const singles = routes.filter((r) => !multi.some(([key]) => key === sectionOf(r.routePath)));
  const frames: Frame[] = [];
  const groups: BoardGroup[] = [];
  let y = 80;
  if (singles.length > 0) {
    frames.push(...gridFrames(singles, y));
    y += bandHeight(singles.length) + gutter;
  }
  for (const [key, rs] of multi) {
    const groupId = `g-${idFromRoutePath(`/${key}`)}`;
    groups.push({ id: groupId, name: titleCaseFromSegment(key) });
    frames.push(...gridFrames(rs, y, groupId));
    y += bandHeight(rs.length) + gutter;
  }
  return { id, name, frames, groups };
}

/**
 * Build the scanned boards: one board per app (a monorepo scan yields
 * several, named after each app's directory), each internally grouped by
 * route section. A single-app scan keeps the historical `app`/"App" board.
 */
export function buildBoardsFromScan(opts: BuildBoardsOpts): Board[] {
  const dims: BoardDims = {
    w: opts.frameWidth ?? 1024,
    h: opts.frameHeight ?? 720,
    cols: opts.columns ?? 3,
    gutter: opts.gutter ?? 80,
  };
  const byApp = new Map<string | undefined, ScannedRoute[]>();
  for (const route of opts.routes) {
    const list = byApp.get(route.appRel);
    if (list) list.push(route);
    else byApp.set(route.appRel, [route]);
  }
  return [...byApp.entries()].map(([appRel, routes]) =>
    appRel === undefined
      ? buildAppBoard("app", "App", routes, dims)
      : buildAppBoard(appSlug(appRel), appRel || "App", routes, dims),
  );
}
