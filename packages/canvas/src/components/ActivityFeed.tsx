import { Bot, ChevronDown, ChevronRight, MousePointer2, TerminalSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ActivityEntry, ActivityTarget } from "../store/activity.ts";
import { useCanvas } from "../store.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";

/**
 * Agent-activity surfaces: the TopBar indicator that pulses while
 * MCP-sourced events arrive, and the toggleable feed panel — verb, target
 * breadcrumb, relative time, session — newest first, backfilled from
 * GET /api/activity and appended live from the WS. Clicking an entry
 * navigates exactly the way Ctrl+K search does (selectBoard →
 * revealSelection → centerOnFrame); entries whose target has since been
 * deleted degrade to non-navigable with a "deleted" chip.
 */

/**
 * The indicator counts as "working" while events arrived within this window.
 * Long enough that sparse agent edits (one mutation, a pause to think, the
 * next) read as continuous presence rather than a blink-and-miss flash. Note
 * it lights for LIVE events only — backfilled history never wakes it.
 */
const ACTIVE_WINDOW_MS = 10_000;

export function AgentActivityIndicator() {
  const lastAt = useCanvas((s) => s.lastAgentActivityAt);
  const feedOpen = useCanvas((s) => s.activityFeedOpen);
  const setFeedOpen = useCanvas((s) => s.setActivityFeedOpen);
  const [, forceTick] = useState(0);

  // Re-evaluate "active" on a timer only while there is something to expire.
  useEffect(() => {
    if (lastAt === null) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1_000);
    return () => clearInterval(timer);
  }, [lastAt]);

  const active = lastAt !== null && Date.now() - lastAt < ACTIVE_WINDOW_MS;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setFeedOpen(!feedOpen)}
      title={active ? "An agent is editing — click for the activity feed" : "Activity feed"}
      className="gap-1.5"
      data-agent-active={active ? "true" : "false"}
    >
      <span className="relative flex h-2 w-2">
        {active ? (
          <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
        ) : null}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`}
        />
      </span>
      <Bot size={14} />
    </Button>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const humanVerb = (verb: string): string => verb.replaceAll("_", " ");

interface Resolved {
  /** Breadcrumb pieces, board → screen → node. */
  crumbs: string[];
  /** Null when the target no longer exists (deleted). */
  navigate: (() => void) | null;
  deleted: boolean;
}

function resolveTarget(target: ActivityTarget): Resolved {
  const state = useCanvas.getState();
  const summary = state.design;
  const crumbs: string[] = [];

  if (target.boardId) {
    const meta = summary?.boards.find((b) => b.id === target.boardId);
    if (!meta) return { crumbs: [target.boardId], navigate: null, deleted: true };
    crumbs.push(meta.name);
  }
  let screenName: string | undefined;
  if (target.screenId) {
    const meta = summary?.screens.find((s) => s.id === target.screenId);
    if (!meta) return { crumbs: [...crumbs, target.screenId], navigate: null, deleted: true };
    screenName = meta.name;
    crumbs.push(meta.name);
  }
  if (target.path) crumbs.push(`node ${target.path.join(".")}`);
  if (target.snippetId) crumbs.push(`snippet ${target.snippetId}`);
  if (target.token) crumbs.push(target.token);
  if (target.themeName) crumbs.push(`theme ${target.themeName}`);
  if (target.extension) crumbs.push(`extension ${target.extension}`);
  void screenName;

  const screenId = target.screenId;
  const boardId = target.boardId;
  if (!screenId && !boardId) return { crumbs, navigate: null, deleted: false };

  // Fly-to navigation: node targets glide straight to the node (locateNode —
  // select + reveal + animated center/zoom); screen/frame targets glide to
  // the hosting frame. The server-enriched `boards` list resolves screens on
  // boards the canvas hasn't loaded — without it the board switch was skipped
  // and the tree's screen picker went blank.
  const navigate = () => {
    void (async () => {
      const s = useCanvas.getState();
      if (s.view !== "boards") s.setView("boards");
      if (screenId && target.path) {
        await useCanvas.getState().locateNode(screenId, target.path.join("."), {
          hostBoards: [...(boardId ? [boardId] : []), ...(target.boards ?? [])],
        });
        return;
      }
      const hinted = target.boards ?? [];
      const hostBoard =
        boardId ??
        (screenId
          ? s.currentBoardId &&
            (s.boards[s.currentBoardId]?.frames.some((f) => f.screen === screenId) ||
              hinted.includes(s.currentBoardId))
            ? s.currentBoardId
            : (Object.values(s.boards).find((b) => b.frames.some((f) => f.screen === screenId))
                ?.id ??
              hinted.find((id) => summary?.boards.some((b) => b.id === id)) ??
              null)
          : null);
      if (hostBoard && hostBoard !== s.currentBoardId) await s.selectBoard(hostBoard);
      if (screenId) await useCanvas.getState().selectScreen(screenId);
      if (!hostBoard) return;
      const frame = useCanvas
        .getState()
        .boards[hostBoard]?.frames.find((f) =>
          target.frameId ? f.id === target.frameId : screenId ? f.screen === screenId : false,
        );
      if (frame) requestAnimationFrame(() => useCanvas.getState().flyToFrame(frame.id));
    })();
  };
  return { crumbs, navigate, deleted: false };
}

function SourceIcon({ source }: { source: ActivityEntry["source"] }) {
  if (source === "mcp") return <Bot size={12} className="text-primary shrink-0" />;
  if (source === "canvas") return <MousePointer2 size={12} className="shrink-0 opacity-60" />;
  return <TerminalSquare size={12} className="shrink-0 opacity-60" />;
}

function FeedRow({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const resolved = resolveTarget(entry.target);
  const grouped = (entry.opCount ?? 0) > 1 || (entry.ops?.length ?? 0) > 1;
  const hiddenOps = (entry.opCount ?? 0) - (entry.ops?.length ?? 0);

  return (
    <li className="border-b border-border/60 last:border-b-0">
      <div className="flex items-start gap-2 px-3 py-2">
        <SourceIcon source={entry.source} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            disabled={resolved.navigate === null}
            onClick={() => resolved.navigate?.()}
            className={`block w-full text-left text-xs ${
              resolved.navigate ? "hover:underline cursor-pointer" : "cursor-default"
            } ${resolved.deleted ? "opacity-50" : ""}`}
          >
            <span className="font-medium">{humanVerb(entry.verb)}</span>
            {grouped ? (
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                {entry.opCount ?? entry.ops?.length} ops
              </Badge>
            ) : null}
            {resolved.deleted ? (
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[10px]">
                deleted
              </Badge>
            ) : null}
            <span className="block truncate text-muted-foreground">
              {resolved.crumbs.join(" › ") || "—"}
            </span>
          </button>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{timeAgo(entry.ts)}</span>
            {entry.session ? (
              <Badge
                variant="secondary"
                className="px-1 py-0"
                title={`MCP session ${entry.session}`}
              >
                agent·{entry.session.slice(0, 4)}
              </Badge>
            ) : null}
          </div>
        </div>
        {grouped ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            title={expanded ? "Collapse ops" : "Expand ops"}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : null}
      </div>
      {expanded && entry.ops ? (
        <ul className="mb-2 ml-8 mr-3 rounded bg-muted/40 px-2 py-1">
          {entry.ops.map((op, i) => {
            const opResolved = resolveTarget(op.target);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: ops are append-only within a static entry
              <li key={i} className="truncate py-0.5 text-[11px]">
                <button
                  type="button"
                  disabled={opResolved.navigate === null}
                  onClick={() => opResolved.navigate?.()}
                  className={opResolved.navigate ? "hover:underline" : "cursor-default opacity-60"}
                >
                  {humanVerb(op.verb)}
                  <span className="ml-1 text-muted-foreground">
                    {opResolved.crumbs.join(" › ")}
                  </span>
                </button>
              </li>
            );
          })}
          {hiddenOps > 0 ? (
            <li className="py-0.5 text-[11px] text-muted-foreground">+{hiddenOps} more</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

export function ActivityFeed() {
  const open = useCanvas((s) => s.activityFeedOpen);
  const setOpen = useCanvas((s) => s.setActivityFeedOpen);
  const events = useCanvas((s) => s.activityEvents);
  const [, forceTick] = useState(0);

  // Keep the relative times honest while the panel is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;
  const newestFirst = [...events].reverse();

  return (
    <aside
      data-activity-feed="true"
      className="fixed right-3 top-14 bottom-10 z-40 flex w-72 flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold">Agent activity</span>
        <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} title="Close">
          <X />
        </Button>
      </div>
      {newestFirst.length === 0 ? (
        <Empty className="px-3 py-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle className="text-xs">No activity yet</EmptyTitle>
            <EmptyDescription className="text-xs">
              Agent and canvas edits will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {newestFirst.map((entry) => (
            <FeedRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </aside>
  );
}
