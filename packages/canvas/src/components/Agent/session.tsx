import type { AgentProviderInfo, AgentSessionSummary } from "@velloo/protocol/agent";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  Lock,
  Pencil,
  Plug,
  Plus,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty.tsx";
import { Input } from "../ui/input.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { homePath } from "./conversation.tsx";

const LIVE = new Set<AgentSessionSummary["state"]>([
  "starting",
  "idle",
  "running",
  "awaiting-approval",
]);
export const isLive = (session: AgentSessionSummary) => LIVE.has(session.state);

/** The session's state as the header says it, with the dot or spinner beside it. */
function SessionState({ session }: { session: AgentSessionSummary }) {
  const dot = (cls: string) => (
    <span className={`size-2 shrink-0 rounded-full ${cls}`} aria-hidden />
  );
  switch (session.state) {
    case "starting":
    case "running":
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <Spinner className="size-3 shrink-0 motion-reduce:animate-none" aria-hidden />
          <span className="truncate">
            {session.state === "starting" ? "Starting…" : "Working…"}
          </span>
        </span>
      );
    case "awaiting-approval":
      return (
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          {dot("bg-primary")}
          <span className="truncate">Waiting for you</span>
        </span>
      );
    case "idle":
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {dot("bg-muted-foreground/50")}
          <span className="truncate">Ready</span>
        </span>
      );
    case "exited":
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {dot("border border-muted-foreground/60")}
          <span className="truncate">Stopped</span>
        </span>
      );
    case "failed":
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-destructive">
          {dot("bg-destructive")}
          <span className="truncate">Stopped unexpectedly</span>
        </span>
      );
  }
}

/** "0:18" since the running turn started, ticking once a second. */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return (
    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground" aria-hidden>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

export interface SessionHeaderProps {
  session: AgentSessionSummary;
  sessions: AgentSessionSummary[];
  provider: AgentProviderInfo | undefined;
  runningSince?: string | undefined;
  onSwitch(id: string): void;
  onNew(): void;
  onRename(title: string): void;
  onCopyResume(): void;
  onStop(): void;
  onReopen(): void;
  onDelete(): void;
}

export function SessionHeader(props: SessionHeaderProps) {
  const { session, provider } = props;
  const env = session.environment;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  // The name field opens once the menu has closed: while it is open the menu
  // holds focus, and on closing it hands focus back to its trigger — either
  // would blur, and so commit, a field opened from inside it.
  const renameOnClose = useRef(false);
  const label = provider?.label ?? session.provider;
  const live = isLive(session);
  const summary = env
    ? [
        env.execution === "local" ? "Local" : "Cloud",
        [label, env.providerVersion].filter(Boolean).join(" "),
        env.model,
        homePath(env.cwd),
        env.sandbox,
        env.approvalMode === "on-request" ? "asks on request" : env.approvalMode,
      ].filter(Boolean)
    : [];
  const commitRename = () => {
    const title = draft.trim();
    setRenaming(false);
    if (title && title !== session.title) props.onRename(title);
  };
  return (
    <div
      className="flex flex-col gap-1.5 border-b border-border px-3 py-2"
      data-agent-session-header
    >
      <div className="flex items-center gap-1">
        {renaming ? (
          <Input
            autoFocus
            aria-label="Session name"
            className="h-8 min-w-0 flex-1 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 min-w-0 flex-1 justify-start gap-1 px-2 text-sm font-medium"
                aria-label={`Session: ${session.title}. Switch session`}
              >
                <span className="truncate">{session.title}</span>
                <ChevronDown size={14} className="shrink-0 opacity-50" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
                This design
              </DropdownMenuLabel>
              {props.sessions.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s.id}
                  checked={s.id === session.id}
                  onSelect={() => props.onSwitch(s.id)}
                >
                  <span className="truncate">{s.title}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={props.onNew}>
                <Plus size={14} aria-hidden />
                New session
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="New session"
          title="New session"
          onClick={props.onNew}
        >
          <Plus size={16} aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 text-muted-foreground"
              aria-label="Session menu"
            >
              <Ellipsis size={16} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            onCloseAutoFocus={(event) => {
              if (!renameOnClose.current) return;
              renameOnClose.current = false;
              event.preventDefault();
              setRenaming(true);
            }}
          >
            <DropdownMenuItem onSelect={props.onNew}>
              <Plus size={14} aria-hidden />
              New session
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDraft(session.title);
                renameOnClose.current = true;
              }}
            >
              <Pencil size={14} aria-hidden />
              Rename
            </DropdownMenuItem>
            {session.terminalCommand ? (
              <DropdownMenuItem onSelect={props.onCopyResume}>
                <Copy size={14} aria-hidden />
                Copy resume command
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {live ? (
              <DropdownMenuItem variant="destructive" onSelect={props.onStop}>
                <Square size={14} aria-hidden />
                Stop agent
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
                <Trash2 size={14} aria-hidden />
                Delete session
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1">
          <SquareTerminal size={12} aria-hidden />
          <span>{label}</span>
        </Badge>
        <SessionState session={session} />
        {props.runningSince && session.state !== "awaiting-approval" ? (
          <Elapsed since={props.runningSince} />
        ) : null}
        {!live && session.resumable ? (
          <Button variant="outline" size="xs" className="ml-auto" onClick={props.onReopen}>
            <RotateCw size={12} aria-hidden />
            Reopen
          </Button>
        ) : null}
      </div>
      {session.stateMessage && !live ? (
        <p
          className={`text-[11px] ${session.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {session.stateMessage}
        </p>
      ) : null}
      {env ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-1 text-left text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight
              size={12}
              className="shrink-0 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            <span className="truncate">{summary.join(" · ")}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              <Row term="Runs">
                {env.execution === "local" ? `On this computer (${env.host})` : "In the cloud"}
              </Row>
              <Row term="Agent">
                {[label, env.providerVersion].filter(Boolean).join(" ")}
                {provider?.account ? ` · ${provider.account}` : ""}
              </Row>
              {env.model ? <Row term="Model">{env.model}</Row> : null}
              <Row term="Folder">
                <span className="font-mono break-all">{env.cwd}</span>
              </Row>
              <Row term="Access">{env.sandbox}</Row>
              <Row term="Asks">{env.approvalMode}</Row>
              <Row term="Resumable">
                {session.resumable ? "Yes — from Velloo or a terminal" : "No"}
              </Row>
            </dl>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const STATUS_BADGE: Record<AgentProviderInfo["status"], string> = {
  ready: "Ready",
  "not-installed": "Not installed",
  incompatible: "Needs an update",
  "logged-out": "Not signed in",
  error: "Unavailable",
};

function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return m < 2880 ? "Yesterday" : `${Math.round(m / 1440)}d ago`;
}

export interface AgentStartProps {
  providers: AgentProviderInfo[];
  /** The agent the person used last, offered first. None yet, and every agent is offered alike. */
  preferred?: string | undefined;
  recent: AgentSessionSummary[];
  starting: string | null;
  onStart(provider: string): void;
  onCheckAgain(): void;
  onOpen(id: string): void;
  onReopen(id: string): void;
}

/** No session open: pick an agent, or go back to one this design already has. */
export function AgentStart(props: AgentStartProps) {
  const primary = props.providers.find((p) => p.id === props.preferred && p.status === "ready")?.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-agent-start>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-6">
        <Empty className="flex-none gap-3 p-0">
          <EmptyHeader className="gap-1.5">
            <EmptyMedia variant="icon">
              <Bot size={16} aria-hidden />
            </EmptyMedia>
            <EmptyTitle className="text-sm">Start an agent session</EmptyTitle>
            <EmptyDescription className="text-xs">
              Your coding agent works on this design and its code, beside the canvas.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <ItemGroup className="gap-2" aria-label="Agents on this computer">
          {props.providers.map((p) => {
            const ready = p.status === "ready";
            return (
              <Item
                key={p.id}
                variant="outline"
                size="sm"
                className="bg-background"
                data-agent-provider={p.id}
              >
                <ItemMedia variant="icon">
                  <SquareTerminal
                    size={16}
                    className={ready ? "" : "text-muted-foreground"}
                    aria-hidden
                  />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="gap-1.5">
                    {p.label}
                    <Badge
                      variant={ready ? "secondary" : "outline"}
                      className={`h-4 gap-1 px-1.5 text-[10px] ${ready ? "" : "text-muted-foreground"}`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${ready ? "bg-primary" : "bg-muted-foreground/60"}`}
                        aria-hidden
                      />
                      {STATUS_BADGE[p.status]}
                    </Badge>
                  </ItemTitle>
                  <ItemDescription className="text-xs">
                    {ready
                      ? [p.account, p.version ? `v${p.version}` : null].filter(Boolean).join(" · ")
                      : (p.message ?? "")}
                  </ItemDescription>
                </ItemContent>
                <ItemFooter>
                  {ready ? (
                    <Button
                      size="sm"
                      variant={p.id === primary ? "default" : "outline"}
                      className="w-full"
                      disabled={props.starting !== null}
                      onClick={() => props.onStart(p.id)}
                    >
                      {props.starting === p.id ? (
                        <Spinner className="size-3.5 motion-reduce:animate-none" />
                      ) : null}
                      Start session
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={props.onCheckAgain}
                    >
                      <RotateCw size={14} aria-hidden />
                      Check again
                    </Button>
                  )}
                </ItemFooter>
              </Item>
            );
          })}
          <Item size="xs" className="text-muted-foreground">
            <ItemMedia variant="icon">
              <Plug size={14} aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-xs font-normal text-muted-foreground">
                OpenCode, Gemini CLI and Goose appear here once installed
              </ItemTitle>
            </ItemContent>
          </Item>
        </ItemGroup>
        {props.recent.length > 0 ? (
          <section className="flex flex-col gap-1" aria-label="Recent sessions">
            <span className="px-1 text-[11px] font-medium text-muted-foreground">
              Recent sessions
            </span>
            <ItemGroup className="gap-0">
              {props.recent.map((s) => (
                <Item key={s.id} size="xs" className="px-1">
                  <ItemContent className="min-w-0 gap-1">
                    <ItemTitle className="w-full min-w-0">
                      <button
                        type="button"
                        className="truncate text-left text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => props.onOpen(s.id)}
                      >
                        {s.title}
                      </button>
                    </ItemTitle>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                        {props.providers.find((p) => p.id === s.provider)?.label ?? s.provider}
                      </Badge>
                      <span>{ago(s.updatedAt)}</span>
                      {isLive(s) ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>Running</span>
                        </>
                      ) : !s.resumable ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>Can't be reopened</span>
                        </>
                      ) : null}
                    </div>
                  </ItemContent>
                  {!isLive(s) && s.resumable ? (
                    <ItemActions>
                      <Button variant="ghost" size="xs" onClick={() => props.onReopen(s.id)}>
                        Reopen
                      </Button>
                    </ItemActions>
                  ) : null}
                </Item>
              ))}
            </ItemGroup>
          </section>
        ) : null}
      </div>
      <div className="flex items-start gap-2 border-t border-border px-3 py-3 text-[11px] leading-snug text-muted-foreground">
        <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Runs on this computer with your own Codex / Claude login. Velloo never sees your
          credentials.
        </span>
      </div>
    </div>
  );
}
