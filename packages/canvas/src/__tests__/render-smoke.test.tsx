import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Board as BoardT, Screen, Snippet } from "@velloo/schema";
import type { ReactElement } from "react";
import { domSuite, mount } from "./dom.ts";
import { type FakeServer, screenFixture, serveFolder, snippetFixture } from "./fake-server.ts";

/**
 * Breadth, not depth. Most of the canvas's component tree had never been
 * imported by a test, let alone rendered — which meant a crash on first paint
 * (a renamed store field, a selector that now returns undefined, a bad import)
 * was only ever found by opening the app. These mount each of the largest
 * panels against a populated store and assert it paints something.
 *
 * A pass here is not a claim that the component is correct; it is a claim that
 * it renders. That's the floor these were missing, and it costs one test each.
 */

const { useCanvas } = await import("../store.ts");

const [BoardsSidebar, Sidebar, TopBar, Tree, Board, Inspector, RightPanel] = await Promise.all([
  import("../components/BoardsSidebar.tsx").then((m) => m.BoardsSidebar),
  import("../components/Sidebar.tsx").then((m) => m.Sidebar),
  import("../components/TopBar.tsx").then((m) => m.TopBar),
  import("../components/Tree.tsx").then((m) => m.Tree),
  import("../components/Board.tsx").then((m) => m.Board),
  import("../components/Inspector.tsx").then((m) => m.Inspector),
  import("../components/RightPanel.tsx").then((m) => m.RightPanel),
]);
const [LibraryHome, LibraryDetail, SnippetView, SnippetParamsPanel, ImagePanel, ThemePanel] =
  await Promise.all([
    import("../components/LibraryHome.tsx").then((m) => m.LibraryHome),
    import("../components/LibraryDetail.tsx").then((m) => m.LibraryDetail),
    import("../components/SnippetView.tsx").then((m) => m.SnippetView),
    import("../components/SnippetParamsPanel.tsx").then((m) => m.SnippetParamsPanel),
    import("../components/ImagePanel.tsx").then((m) => m.ImagePanel),
    import("../components/ThemePanel.tsx").then((m) => m.ThemePanel),
  ]);
const [NotesLayer, ContrastReport, CommentsPanel, SettingsMenu, PublishDialog, ExportDialog] =
  await Promise.all([
    import("../components/NotesLayer.tsx").then((m) => m.NotesLayer),
    import("../components/ContrastReport.tsx").then((m) => m.ContrastReport),
    import("../components/CommentsPanel.tsx").then((m) => m.CommentsPanel),
    import("../components/SettingsMenu.tsx").then((m) => m.SettingsMenu),
    import("../components/PublishDialog.tsx").then((m) => m.PublishDialog),
    import("../components/ExportDialog.tsx").then((m) => m.ExportDialog),
  ]);
const [SignInDialog, PreviewDialog, SettingsDialog] = await Promise.all([
  import("../components/SignInDialog.tsx").then((m) => m.SignInDialog),
  import("../components/PreviewDialog.tsx").then((m) => m.PreviewDialog),
  import("../components/Settings/SettingsDialog.tsx").then((m) => m.SettingsDialog),
]);
const { App } = await import("../App.tsx");
const activity = await import("../components/ActivityFeed.tsx");
const { NodeHud } = await import("../components/hud/NodeHud.tsx");
const { FolderPane } = await import("../components/Settings/FolderPane.tsx");
const { BoardPane } = await import("../components/Settings/BoardPane.tsx");
const { CanvasPane } = await import("../components/Settings/CanvasPane.tsx");

let server: FakeServer;
const views: { unmount(): Promise<void> }[] = [];

/**
 * React validates DOM nesting on render and reports it through `console.error`
 * — the only channel that catches invalid markup (`<li>` inside `<li>`, a
 * `<div>` in a `<p>`) before a browser does. Mounting every panel means one
 * watcher covers all of them, so treat it as a failure rather than log noise.
 */
const nestingErrors: string[] = [];
const realConsoleError = console.error;

/** The App root opens a socket; live sync has its own suite. */
class InertSocket {
  close(): void {}
}
const realWebSocket = globalThis.WebSocket;

/** One source for the board shape — the fixture the fake server serves. */
const board = (): BoardT => server.boards.main as BoardT;

const snippet = (): Snippet => snippetFixture("card");

beforeEach(() => {
  nestingErrors.length = 0;
  console.error = (...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (/cannot be a descendant of|cannot contain a nested/.test(message)) {
      nestingErrors.push(message.trim());
      return;
    }
    realConsoleError(...args);
  };
  globalThis.WebSocket = InertSocket as unknown as typeof WebSocket;
  server = serveFolder({ boards: { main: ["home"] }, screens: ["pricing"] });
  useCanvas.setState({
    design: server.design as never,
    folderConfig: null,
    boards: { main: board() },
    screens: { home: screenFixture("home") as Screen },
    currentBoardId: "main",
    currentScreenId: "home",
    theme: server.themes.default as never,
    themeName: "default",
    presets: ["ember", "violet"],
    components: [],
    generatedAssets: {},
    selection: null,
    hover: null,
    reveal: null,
    annotations: [],
    notes: [],
    commentThreads: [],
    activityEvents: [],
    wsConnected: true,
    canvasZoom: 1,
    pan: { x: 0, y: 0 },
  });
});

afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  console.error = realConsoleError;
  globalThis.WebSocket = realWebSocket;
  server.restore();
});

/**
 * `paints: false` for the dialogs and overlays that legitimately render
 * nothing until opened — the value there is that the module loads and the
 * component's selectors resolve.
 */
const cases: { name: string; render: () => ReactElement; paints?: boolean }[] = [
  {
    name: "BoardsSidebar",
    render: () => (
      <BoardsSidebar
        boards={server.design.boards}
        screens={server.design.screens}
        currentBoardId="main"
        currentScreenId="home"
      />
    ),
  },
  {
    name: "Sidebar",
    render: () => (
      <Sidebar
        boards={server.design.boards}
        screens={server.design.screens}
        snippets={[]}
        currentBoardId="main"
        currentScreenId="home"
      />
    ),
  },
  { name: "TopBar", render: () => <TopBar /> },
  { name: "Tree", render: () => <Tree screen={useCanvas.getState().screens.home as Screen} /> },
  { name: "Board", render: () => <Board board={board()} /> },
  { name: "Inspector", render: () => <Inspector /> },
  { name: "RightPanel", render: () => <RightPanel screenId="home" /> },
  { name: "LibraryHome", render: () => <LibraryHome snippets={[]} /> },
  {
    name: "LibraryDetail",
    render: () => <LibraryDetail item={{ kind: "snippet", id: "card" }} snippets={[]} />,
  },
  {
    name: "SnippetView",
    render: () => <SnippetView snippetId="card" snippetMeta={null} presets={[]} />,
  },
  {
    name: "SnippetParamsPanel",
    render: () => <SnippetParamsPanel snippet={snippet()} onPatchParams={() => undefined} />,
  },
  {
    name: "ImagePanel",
    render: () => <ImagePanel screenId="home" path="0" src="assets/hero.png" />,
  },
  {
    name: "ThemePanel",
    render: () => (
      <ThemePanel theme={useCanvas.getState().theme as never} presets={["ember", "violet"]} />
    ),
  },
  { name: "NodeHud", render: () => <NodeHud />, paints: false },
  { name: "NotesLayer", render: () => <NotesLayer />, paints: false },
  { name: "ContrastReport", render: () => <ContrastReport bumpKey={0} /> },
  { name: "CommentsPanel", render: () => <CommentsPanel /> },
  { name: "ActivityFeed", render: () => <activity.ActivityFeed />, paints: false },
  { name: "AgentActivityIndicator", render: () => <activity.AgentActivityIndicator /> },
  { name: "SettingsMenu", render: () => <SettingsMenu /> },
  { name: "CanvasPane", render: () => <CanvasPane /> },
  { name: "PublishDialog", render: () => <PublishDialog />, paints: false },
  { name: "ExportDialog", render: () => <ExportDialog />, paints: false },
  { name: "SignInDialog", render: () => <SignInDialog />, paints: false },
  { name: "PreviewDialog", render: () => <PreviewDialog />, paints: false },
  { name: "SettingsDialog", render: () => <SettingsDialog />, paints: false },
  { name: "App", render: () => <App /> },
];

domSuite("every large panel renders", () => {
  for (const { name, render, paints = true } of cases) {
    test(name, async () => {
      const view = await mount(render());
      views.push(view);
      if (paints) expect(view.host.innerHTML).not.toBe("");
      expect(nestingErrors).toEqual([]);
    });
  }
});

domSuite("the settings panes render against a real folder config", () => {
  beforeEach(async () => {
    await useCanvas.getState().loadFolderConfig();
  });

  for (const [name, Pane] of [
    ["FolderPane", FolderPane],
    ["BoardPane", BoardPane],
  ] as const) {
    test(name, async () => {
      const cfg = useCanvas.getState().folderConfig;
      if (!cfg) throw new Error("folder config did not load");
      const view = await mount(<Pane cfg={cfg} />);
      views.push(view);
      expect(view.host.innerHTML).not.toBe("");
      expect(nestingErrors).toEqual([]);
    });
  }
});
