import type { Manifest, StyleChannel } from "@velloo/provider";
import type { Board, Screen, Snippet, Theme } from "@velloo/schema";
import type {
  BoardCommentCounts,
  ComponentDiagnostic,
  DesignRulesState,
  DesignSummary,
  FolderConfig,
  HistoryDepths,
  PublishedBoard,
  PublishGuest,
  PublishRequest,
  PublishSlot,
  RepoCatalogEntry,
  StartingPoint,
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
    // `primary` is required by the schema; a fixture without it is a theme
    // no server could send, and the role editor rightly assumes it is there.
    colors: { background: "#ffffff", foreground: "#111111", primary: "#4f46e5" },
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
  /** Why `/api/publish/targets` says this account can't publish, if it can't. */
  publishBlocked: string | null;
  /** What `/api/publish/published` lists; a DELETE removes from it. */
  publishedBoards: PublishedBoard[];
  /**
   * The person's prefs file, as `/api/prefs` reads and writes it. Every hint
   * starts out dismissed, so an App mount isn't dotted with them unless a test asks.
   */
  userPrefs: { hintsSeen: string[] };
  /** The teams `/api/publish/targets` offers to publish into. */
  publishTeams: { id: string; name: string; isDefault?: boolean }[];
  /** Every body POSTed to `/api/publish`, in order. */
  readonly publishRequests: PublishRequest[];
  /** Each published board's guests, by slug — the guest routes read and change it. */
  guests: Record<string, PublishGuest[]>;
  /** Whether an invite or resend "emails" the guest; off hands the link back instead. */
  guestEmail: boolean;
  /** What `/api/comments/summary` answers: open threads per board. */
  commentCounts: Record<string, BoardCommentCounts>;
  /** Every guest action, as `<verb> <slug> <guest id or email>`. */
  readonly guestCalls: string[];
  /** The provider manifest `/api/components` serves. */
  manifest: Manifest;
  /** The app's own components, as `/api/repo/components` serves them. */
  repoEntries: RepoCatalogEntry[];
  /** What `/api/repo/status` answers per catalog id; unlisted ids get no diagnostic. */
  repoStatus: Record<string, ComponentDiagnostic>;
  /**
   * The same for `/api/components/status`, by library then manifest id. A
   * request naming no library asks about `design.defaultLibrary`.
   */
  libraryStatus: Record<string, Record<string, ComponentDiagnostic>>;
  /** The directions `/api/theme/starting-points` offers. */
  startingPoints: StartingPoint[];
  /** The one the theme still exactly is; null once anything it set was changed. */
  activeStartingPoint: string | null;
  /** What `/api/theme/contrast` scores: one entry per text pair, by tier. */
  contrast: { tier: string }[];
  /** The design's rules, as `/api/design-language` serves and its saves replace. */
  rules: DesignRulesState;
  /** The colour slots the design's framework reads; null where it does not say. */
  frameworkRoles: string[] | null;
  /** Every path requested, in order. */
  readonly calls: string[];
  /** Mutations posted through `/api/mutate/*`, in order. */
  readonly mutations: { op: string; args: unknown }[];
  /** What a mutation answers, by op. An op not listed answers `{}`. */
  replies: Record<string, unknown>;
  /**
   * Theme operations posted through `/api/theme/*`, in order. Recorded, not
   * applied — except `add_theme` and `remove_theme`, which a later
   * `/api/theme?name=` has to agree with.
   */
  readonly themeWrites: { op: string; args: unknown }[];
  /** Every baseline posted to `/api/design-language/restore`, in order. */
  readonly restores: unknown[];
  /** Paths matching `match` fail with `status` until {@link clearFailures}. */
  fail(match: string | RegExp, status?: number): void;
  clearFailures(): void;
  /** Paths matching `match` take `ms` to be answered — and to take effect. */
  slow(match: string, ms: number): void;
  /**
   * Paths matching `match` wait, unanswered and without effect, until the
   * returned release is called — an order a timed {@link slow} can only hope
   * for on a slow runner.
   */
  hold(match: string): () => void;
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
    defaultLibrary: "ui",
    screens: [...screenIds].map((id) => ({ id, name: id, library: "ui" })),
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
  const delays: { match: string; ms: number }[] = [];
  const holds: { match: string; released: Promise<void> }[] = [];
  const calls: string[] = [];
  const mutations: { op: string; args: unknown }[] = [];
  const themeWrites: { op: string; args: unknown }[] = [];
  const restores: unknown[] = [];
  const publishRequests: PublishRequest[] = [];
  const guestCalls: string[] = [];

  const server: FakeServer = {
    design,
    boards,
    screens,
    snippets: {},
    themes,
    history: { undo: 0, redo: 0 },
    publishSlots: [],
    publishBlocked: null,
    publishedBoards: [],
    userPrefs: { hintsSeen: ["agent", "board", "design", "comments", "library"] },
    publishTeams: [],
    publishRequests,
    guests: {},
    guestEmail: true,
    commentCounts: {},
    guestCalls,
    manifest: [],
    repoEntries: [],
    repoStatus: {},
    libraryStatus: {},
    startingPoints: [],
    activeStartingPoint: null,
    contrast: [],
    rules: { source: null, intent: "", rules: [] },
    frameworkRoles: null,
    calls,
    mutations,
    replies: {},
    themeWrites,
    restores,
    fail(match, status = 500) {
      failures.push({ match, status });
    },
    clearFailures() {
      failures.length = 0;
    },
    slow(match, ms) {
      delays.push({ match, ms });
    },
    hold(match) {
      let release = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.push({ match, released });
      return release;
    },
    restore() {
      globalThis.fetch = realFetch;
    },
  };

  function routeGuests(path: string, method: string, body: unknown): Response | null {
    const match = path.match(
      /^\/api\/publish\/published\/([^/]+)\/guests(?:\/([^/]+)(?:\/(\w+))?)?$/,
    );
    if (!match) return null;
    const slug = decodeURIComponent(match[1] as string);
    const guestId = match[2] ? decodeURIComponent(match[2]) : null;
    const action = match[3] ?? null;
    const list = server.guests[slug] ?? [];
    server.guests[slug] = list;
    const link = (id: string) =>
      `https://share.velloo.dev/s/${slug}/guest?t=${id}-${guestCalls.length}`;
    const delivered = (guest: PublishGuest) =>
      server.guestEmail
        ? { guest, emailed: true }
        : { guest, emailed: false, reason: "email is off", guestUrl: link(guest.id) };
    if (!guestId) {
      if (method === "GET") return json({ guests: list });
      const { email, name } = body as { email: string; name?: string };
      guestCalls.push(`invite ${slug} ${email}`);
      const guest: PublishGuest = {
        id: `g${list.length + 1}`,
        name: name ?? null,
        email,
        createdAt: new Date().toISOString(),
        lastSeenAt: null,
        linkExpiresAt: null,
      };
      list.push(guest);
      return json(delivered(guest), 201);
    }
    const guest = list.find((g) => g.id === guestId);
    if (!guest) return json({ error: { kind: "HttpFailure", message: "no such guest" } }, 502);
    guestCalls.push(`${action ?? method.toLowerCase()} ${slug} ${guestId}`);
    if (action === "resend") return json(delivered(guest));
    if (action === "link") return json({ guestUrl: link(guestId) });
    server.guests[slug] = list.filter((g) => g.id !== guestId);
    return json({ ok: true });
  }

  function route(path: string, search: URLSearchParams, method: string, body: unknown): Response {
    const guests = routeGuests(path, method, body);
    if (guests) return guests;
    const unpublish = path.match(/^\/api\/publish\/published\/(.+)$/);
    if (unpublish && method === "DELETE") {
      const slug = decodeURIComponent(unpublish[1] as string);
      server.publishedBoards = server.publishedBoards.filter((board) => board.slug !== slug);
      return json({ ok: true });
    }
    if (path === "/api/design") return json(server.design);
    if (path === "/api/prefs") {
      if (method === "POST") {
        const patch = body as { dismissHints?: string[]; resetHints?: true };
        const seen = patch.resetHints ? [] : server.userPrefs.hintsSeen;
        server.userPrefs = { hintsSeen: [...new Set([...seen, ...(patch.dismissHints ?? [])])] };
      }
      return json(server.userPrefs);
    }
    if (path === "/api/undo") return json(server.history);
    if (path === "/api/theme") {
      const theme = server.themes[search.get("name") ?? "default"];
      return theme ? json(theme) : json({ error: { kind: "not-found" } }, 404);
    }
    if (path === "/api/theme/starting-points") {
      return json({ startingPoints: server.startingPoints, active: server.activeStartingPoint });
    }
    if (path === "/api/theme/contrast") return json({ results: server.contrast });
    const themeOp = path.match(/^\/api\/theme\/(\w+)$/)?.[1];
    if (themeOp && method === "POST") {
      themeWrites.push({ op: themeOp, args: body });
      if (themeOp === "add_theme") {
        const { name, from } = body as { name: string; from?: string };
        const source = server.themes[from ?? "default"];
        if (source) server.themes[name] = { ...source, name };
      }
      if (themeOp === "remove_theme") delete server.themes[(body as { name: string }).name];
      return json({});
    }
    if (path === "/api/design-language") {
      return json({ rules: server.rules, frameworkRoles: server.frameworkRoles });
    }
    if (path === "/api/design-language/rules" && method === "POST") {
      const next = body as Pick<DesignRulesState, "intent" | "rules">;
      // The first save is what creates the design's own `guidance.md`.
      server.rules = {
        source: server.rules.source ?? { path: "guidance.md", writable: true },
        ...next,
      };
      return json({ rules: server.rules });
    }
    if (path === "/api/design-language/restore" && method === "POST") {
      restores.push(body);
      // `rules: null` — the design followed no document then; absent leaves them alone.
      const { rules } = body as { rules?: Pick<DesignRulesState, "intent" | "rules"> | null };
      if (rules === null) server.rules = { source: null, intent: "", rules: [] };
      else if (rules) server.rules = { ...server.rules, ...rules };
      return json({ rules: server.rules });
    }
    if (path === "/api/components") {
      return json({ manifest: server.manifest, styleChannel: CHANNEL, channelsByLibrary: {} });
    }
    if (path === "/api/components/status") {
      const ids = (search.get("ids") ?? "").split(",").filter(Boolean);
      const library = server.libraryStatus[search.get("library") || design.defaultLibrary || ""];
      return json({ diagnostics: ids.flatMap((id) => (library?.[id] ? [library[id]] : [])) });
    }
    if (path === "/api/repo/components") {
      return json({ entries: server.repoEntries, apps: [], warnings: [] });
    }
    if (path === "/api/repo/status") {
      const ids = (search.get("ids") ?? "").split(",").filter(Boolean);
      return json({
        diagnostics: ids.flatMap((id) => (server.repoStatus[id] ? [server.repoStatus[id]] : [])),
      });
    }
    if (path === "/api/assets") return json({});
    if (path === "/api/comments") return json({ threads: [] });
    if (path === "/api/comments/summary") return json({ boards: server.commentCounts });
    if (path === "/api/config") {
      return json({
        root: "/tmp/design",
        designName: "design",
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
    if (path.startsWith("/api/mutate/")) {
      return json(server.replies[path.slice("/api/mutate/".length)] ?? {});
    }
    if (path === "/api/publish/targets") {
      return json({
        ready: true,
        access: "ready",
        teams: server.publishTeams,
        ...(server.publishBlocked ? { blocked: server.publishBlocked } : {}),
        slots: server.publishSlots,
      });
    }
    if (path === "/api/publish/status") return json({ state: "idle" });
    if (path === "/api/publish" && method === "POST") {
      publishRequests.push(body as PublishRequest);
      return json(
        {
          state: "running",
          step: "start",
          message: "starting",
          startedAt: new Date().toISOString(),
          warnings: [],
        },
        202,
      );
    }
    if (path === "/api/publish/published") return json({ boards: server.publishedBoards });
    return json({ error: { kind: "not-found" } }, 404);
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://localhost");
    calls.push(url.pathname + url.search);
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const op = url.pathname.match(/^\/api\/mutate\/(.+)$/)?.[1];
    if (op) mutations.push({ op, args: body });
    const delay = delays.find(({ match }) => url.pathname.includes(match));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay.ms));
    const held = holds.find(({ match }) => url.pathname.includes(match));
    if (held) await held.released;
    const failure = failures.find(({ match }) =>
      typeof match === "string" ? url.pathname.includes(match) : match.test(url.pathname),
    );
    // A daemon that is down or restarting answers with no envelope at all —
    // which is the path `toApiError` falls back on, and what boot failures see.
    if (failure) return new Response("unavailable", { status: failure.status });
    return route(url.pathname, url.searchParams, init?.method ?? "GET", body);
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
