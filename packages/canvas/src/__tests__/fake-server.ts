import type { StyleChannel } from "@velloo/provider";
import type { Board, Screen, Snippet, Theme } from "@velloo/schema";
import type {
  DesignSummary,
  FolderConfig,
  HistoryDepths,
  PublishedBoard,
  PublishSlot,
} from "../api.ts";

/**
 * A routed `fetch` standing in for the daemon, so the store slices can be
 * driven the way the canvas drives them: through the real API layer, against
 * a folder that answers like a server and can change underfoot mid-test.
 *
 * Stubbing `fetch` rather than mocking `../api.ts` is deliberate — the store's
 * interesting behaviour is what it does with what the *server* said (a board
 * that 404s, a summary that no longer lists it), and a module mock asserts
 * against a shape someone hand-wrote instead.
 */

/** A board's frames, given as the screen each one shows, in order. */
export type FolderSpec = {
  boards?: Record<string, string[]>;
  /** Screens with no frame anywhere — reachable only by id. */
  screens?: string[];
  defaultBoard?: string | null;
  defaultScreen?: string | null;
  /** Boards that pin a theme other than the folder default. */
  boardThemes?: Record<string, string>;
};

/** Frame ids are derived, so a test can name one without reading the fixture. */
export const frameId = (boardId: string, index = 0): string => `${boardId}-f${index}`;

export function screenFixture(id: string): Screen {
  return {
    id,
    name: id,
    tree: {
      $ref: "Box",
      children: [
        { $ref: "Heading", props: { children: id } },
        { $ref: "Text", props: { children: "body" } },
      ],
    },
  } as Screen;
}

export function snippetFixture(id: string): Snippet {
  return {
    id,
    name: id,
    params: [],
    tree: { $ref: "Box", children: [{ $ref: "Text", props: { children: id } }] },
  } as unknown as Snippet;
}

function themeFixture(name: string): Theme {
  return {
    name,
    colors: { background: "#ffffff", foreground: "#111111" },
    typography: { fontFamily: { sans: "Inter, sans-serif" } },
    spacing: {},
    radius: {},
  } as unknown as Theme;
}

const CHANNEL: StyleChannel = {
  kind: "tailwind-classname",
  prop: "className",
  needsTailwindJit: true,
  editorLabel: "Tailwind classes",
};

export interface FakeServer {
  /** Mutable server-side state — change it, then fire the matching event. */
  design: DesignSummary;
  boards: Record<string, Board>;
  screens: Record<string, Screen>;
  snippets: Record<string, Snippet>;
  themes: Record<string, Theme>;
  history: HistoryDepths;
  /** What `/api/publish/targets` offers as update destinations. */
  publishSlots: PublishSlot[];
  /** What `/api/publish/published` lists; a DELETE removes from it. */
  publishedBoards: PublishedBoard[];
  /** Every path requested, in order. */
  readonly calls: string[];
  /** Mutations posted through `/api/mutate/*`, in order. */
  readonly mutations: { op: string; args: unknown }[];
  /** Paths matching `match` fail with `status` until {@link clearFailures}. */
  fail(match: string | RegExp, status?: number): void;
  clearFailures(): void;
  restore(): void;
}

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function serveFolder(spec: FolderSpec = {}): FakeServer {
  const boardSpecs = spec.boards ?? { main: ["home"] };
  const screenIds = new Set<string>(spec.screens ?? []);
  for (const screens of Object.values(boardSpecs)) for (const id of screens) screenIds.add(id);

  const boards: Record<string, Board> = {};
  for (const [boardId, screens] of Object.entries(boardSpecs)) {
    boards[boardId] = {
      id: boardId,
      name: boardId,
      // `BoardSchema` defaults this, so every board the server serves has it —
      // a fixture without it is a shape production can't produce.
      groups: [],
      frames: screens.map((screen, i) => ({
        id: frameId(boardId, i),
        screen,
        x: i * 500,
        y: 0,
        w: 400,
        h: 300,
      })),
      ...(spec.boardThemes?.[boardId] ? { theme: spec.boardThemes[boardId] } : {}),
    } as Board;
  }

  const screens: Record<string, Screen> = {};
  for (const id of screenIds) screens[id] = screenFixture(id);

  const design: DesignSummary = {
    snapshotVersion: "test",
    theme: { name: "default" },
    defaultScreen: spec.defaultScreen ?? null,
    defaultBoard: spec.defaultBoard ?? null,
    viewportPresets: [],
    screens: [...screenIds].map((id) => ({ id, name: id })),
    boards: Object.values(boards).map((b) => ({
      id: b.id,
      name: b.name,
      frameCount: b.frames.length,
      group: null,
    })),
    snippets: [],
  };

  const themes: Record<string, Theme> = { default: themeFixture("default") };
  for (const name of Object.values(spec.boardThemes ?? {})) themes[name] = themeFixture(name);

  const failures: { match: string | RegExp; status: number }[] = [];
  const calls: string[] = [];
  const mutations: { op: string; args: unknown }[] = [];

  const server: FakeServer = {
    design,
    boards,
    screens,
    snippets: {},
    themes,
    history: { undo: 0, redo: 0 },
    publishSlots: [],
    publishedBoards: [],
    calls,
    mutations,
    fail(match, status = 500) {
      failures.push({ match, status });
    },
    clearFailures() {
      failures.length = 0;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };

  function route(path: string, search: URLSearchParams, method: string): Response {
    const unpublish = path.match(/^\/api\/publish\/published\/(.+)$/);
    if (unpublish && method === "DELETE") {
      const slug = decodeURIComponent(unpublish[1] as string);
      server.publishedBoards = server.publishedBoards.filter((board) => board.slug !== slug);
      return json({ ok: true });
    }
    if (path === "/api/design") return json(server.design);
    if (path === "/api/undo") return json(server.history);
    if (path === "/api/theme/presets") return json({ presets: ["ember", "violet"] });
    if (path === "/api/theme") {
      const theme = server.themes[search.get("name") ?? "default"];
      return theme ? json(theme) : json({ error: { kind: "not-found" } }, 404);
    }
    if (path === "/api/components") {
      return json({ manifest: [], styleChannel: CHANNEL, channelsByLibrary: {} });
    }
    if (path === "/api/assets") return json({});
    if (path === "/api/comments") return json({ threads: [] });
    if (path === "/api/config") {
      return json({
        root: "/tmp/design",
        folderName: "design",
        schemaVersion: 2,
        toolVersion: "test",
        folderId: null,
        defaultLibrary: "shadcn",
        libraries: [],
        styling: "tailwind",
        viewportPresets: [],
        defaultBoard: server.design.defaultBoard,
        defaultScreen: server.design.defaultScreen,
        componentsAlias: null,
        feedback: { enabled: false, contactOk: false },
        themes: Object.keys(server.themes),
        extensionsCount: 0,
      } satisfies FolderConfig);
    }
    const screen = path.match(/^\/api\/screen\/(.+)$/);
    if (screen) {
      const found = server.screens[decodeURIComponent(screen[1] as string)];
      return found ? json(found) : json({ error: { kind: "not-found" } }, 404);
    }
    const snippet = path.match(/^\/api\/snippets\/(.+)$/);
    if (snippet) {
      const found = server.snippets[decodeURIComponent(snippet[1] as string)];
      return found ? json(found) : new Response("not found", { status: 404 });
    }
    const board = path.match(/^\/api\/board\/(.+)$/);
    if (board) {
      const found = server.boards[decodeURIComponent(board[1] as string)];
      return found ? json(found) : json({ error: { kind: "not-found" } }, 404);
    }
    if (path.startsWith("/api/annotations/")) return json({ annotations: [] });
    if (path.startsWith("/api/notes/")) return json({ notes: [] });
    if (path.startsWith("/api/mutate/")) return json({});
    if (path === "/api/publish/targets") {
      return json({ ready: true, access: "ready", teams: [], slots: server.publishSlots });
    }
    if (path === "/api/publish/status") return json({ state: "idle" });
    if (path === "/api/publish/published") return json({ boards: server.publishedBoards });
    return json({ error: { kind: "not-found" } }, 404);
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://localhost");
    calls.push(url.pathname + url.search);
    const op = url.pathname.match(/^\/api\/mutate\/(.+)$/)?.[1];
    if (op) {
      mutations.push({
        op,
        args: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
    }
    const failure = failures.find(({ match }) =>
      typeof match === "string" ? url.pathname.includes(match) : match.test(url.pathname),
    );
    // A daemon that is down or restarting answers with no envelope at all —
    // which is the path `toApiError` falls back on, and what boot failures see.
    if (failure) return new Response("unavailable", { status: failure.status });
    return route(url.pathname, url.searchParams, init?.method ?? "GET");
  }) as unknown as typeof fetch;

  return server;
}

/** A `localStorage` the tests own, for the "where I left off" precedence. */
export function stubLocalStorage(seed: Record<string, string> = {}): () => void {
  const store = new Map(Object.entries(seed));
  const had = "localStorage" in globalThis;
  const previous = (globalThis as { localStorage?: Storage | undefined }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
  };
  return () => {
    if (had) (globalThis as { localStorage?: Storage | undefined }).localStorage = previous;
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  };
}
