import type {
  AgentHistoryEntry,
  AgentModelOption,
  AgentProviderInfo,
  AgentSessionSummary,
} from "@velloo/protocol/agent";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  History,
  Lock,
  Pencil,
  Plug,
  Plus,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { PulseDot } from "../PulseDot.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty.tsx";
import { Input } from "../ui/input.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "../ui/item.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { homePath } from "./conversation.tsx";
import { ModelMenu } from "./model-menu.tsx";
import { ProviderLogo } from "./provider-logo.tsx";

const LIVE = new Set<AgentSessionSummary["state"]>([
  "starting",
  "idle",
  "running",
  "awaiting-approval",
]);
export const isLive = (session: AgentSessionSummary) => LIVE.has(session.state);

/** The session's state as the header says it, with a dot beside it that pulses while it works. */
function SessionState({ session }: { session: AgentSessionSummary }) {
  const dot = (cls: string) => (
    <span className={`size-2 shrink-0 rounded-full ${cls}`} aria-hidden />
  );
  switch (session.state) {
    case "starting":
    case "running":
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <PulseDot />
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
  /** Back to the agents and this design's recent sessions; the session keeps running. */
  onBack(): void;
  /** A fresh session with this session's agent. */
  onNewWithAgent(): void;
  /** The model a live session runs on, and the ones it can switch to from the next message. */
  model?: { label: string; id?: string | undefined; options: AgentModelOption[] } | undefined;
  onModel?: ((model: string) => void) | undefined;
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
        <Button
          variant="ghost"
          size="icon-sm"
          className="-ml-1.5 shrink-0 text-muted-foreground"
          aria-label="Back to agents"
          title="Back to agents"
          onClick={props.onBack}
        >
          <ChevronLeft size={16} aria-hidden />
        </Button>
        {renaming ? (
          <Input
            autoFocus
            aria-label="Session name"
            onFocus={(e) => e.currentTarget.select()}
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
                className="min-w-0 flex-1 justify-start gap-1 px-1.5 text-sm font-medium"
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
          aria-label={`New ${label} session`}
          title={`New ${label} session`}
          onClick={props.onNewWithAgent}
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
        {props.model ? (
          <ModelMenu
            provider={session.provider}
            providerLabel={label}
            label={props.model.label}
            model={props.model.id}
            models={props.model.options}
            onModel={(model) => props.onModel?.(model)}
          />
        ) : (
          <Badge variant="outline" className="shrink-0 gap-1">
            <ProviderLogo provider={session.provider} size={12} />
            <span>{label}</span>
          </Badge>
        )}
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
              <Row term="Session ID">
                <SessionId id={session.providerSessionId ?? session.id} />
              </Row>
            </dl>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/** The agent's own id for the session — what its `--resume` takes — to copy. */
function SessionId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="font-mono break-all select-all" data-agent-session-id>
        {id}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-5 shrink-0 text-muted-foreground"
        aria-label={copied ? "Session ID copied" : "Copy the session ID"}
        title={copied ? "Copied" : "Copy"}
        onClick={() =>
          void navigator.clipboard?.writeText(id).then(
            () => setCopied(true),
            () => {},
          )
        }
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      </Button>
    </span>
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

/**
 * A few of the Agent Client Protocol agents the daemon lists only once they're
 * installed — the hint names the ones not listed yet.
 */
const MORE_AGENTS = ["GitHub Copilot", "Cursor", "Gemini CLI", "OpenCode"];

/** Stand-ins for the agent cards while the daemon asks each agent whether it is installed. */
function ProviderSkeletons({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <ItemGroup
        className="gap-0 rounded-lg border border-border bg-background has-data-[size=xs]:gap-0"
        role="status"
        aria-label="Looking for agents…"
      >
        {[0, 1, 2].map((n) => (
          <Fragment key={n}>
            {n > 0 ? <ItemSeparator className="my-0" /> : null}
            <Item size="xs" className="rounded-none" aria-hidden>
              <ItemMedia variant="icon">
                <Skeleton className="size-3.5 rounded-sm" />
              </ItemMedia>
              <ItemContent>
                <Skeleton className="h-3 w-24" />
              </ItemContent>
              <ItemActions>
                <Skeleton className="h-6 w-12" />
              </ItemActions>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    );
  }
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Looking for agents…">
      {[0, 1, 2].map((n) => (
        <Item key={n} variant="outline" size="sm" className="bg-background" aria-hidden>
          <ItemMedia variant="icon">
            <Skeleton className="size-4 rounded-sm" />
          </ItemMedia>
          <ItemContent className="gap-1.5">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-4 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-32" />
          </ItemContent>
          <ItemFooter>
            <Skeleton className="h-7 w-full" />
          </ItemFooter>
        </Item>
      ))}
    </div>
  );
}

export interface AgentStartProps {
  /** Null while the daemon is still looking for agents. */
  providers: AgentProviderInfo[] | null;
  /** The look for agents failed, so there is no list to show. */
  loadError?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  /** The agent the person used last: listed first, as the one to start. */
  preferred?: string | undefined;
  recent: AgentSessionSummary[];
  starting: string | null;
  onStart(provider: string): void;
  onCheckAgain(): void;
  onOpen(id: string): void;
  onReopen(id: string): void;
  /** Sessions an agent kept for this app outside the tab, newest first. */
  loadHistory?: ((provider: string) => Promise<AgentHistoryEntry[]>) | undefined;
  /** Continue one of them here. */
  onResume?: ((provider: string, providerSessionId: string) => void) | undefined;
}

/** Recent sessions shown before the rest are behind "Show all". */
const RECENT_SHOWN = 5;

/** What a ready agent's card says under its name. */
function providerMeta(p: AgentProviderInfo, preferred: string | undefined): string {
  return [p.id === preferred ? "Last used" : null, p.account, p.version ? `v${p.version}` : null]
    .filter(Boolean)
    .join(" · ");
}

function StatusBadge({ status }: { status: AgentProviderInfo["status"] }) {
  const ready = status === "ready";
  return (
    <Badge
      variant={ready ? "secondary" : "outline"}
      className={`h-4 gap-1 px-1.5 text-[10px] ${ready ? "" : "text-muted-foreground"}`}
    >
      <span
        className={`size-1.5 rounded-full ${ready ? "bg-primary" : "bg-muted-foreground/60"}`}
        aria-hidden
      />
      {STATUS_BADGE[status]}
    </Badge>
  );
}

interface PickerProps {
  providers: AgentProviderInfo[];
  preferred: string | undefined;
  /** The one agent whose button is the highlighted start. */
  primary: string | undefined;
  starting: string | null;
  onStart(provider: string): void;
  onCheckAgain(): void;
}

function StartButton(props: PickerProps & { provider: AgentProviderInfo; compact?: boolean }) {
  const { provider: p, compact } = props;
  return (
    <Button
      size={compact ? "xs" : "sm"}
      variant={p.id === props.primary ? "default" : "outline"}
      className={compact ? "" : "w-full"}
      disabled={props.starting !== null}
      aria-label={compact ? `Start a session with ${p.label}` : undefined}
      onClick={() => props.onStart(p.id)}
    >
      {props.starting === p.id ? <Spinner className="size-3.5 motion-reduce:animate-none" /> : null}
      {compact ? "Start" : "Start session"}
    </Button>
  );
}

/** First use: every agent as a card that says what it is and what it needs. */
function ProviderCards(props: PickerProps) {
  const notYetListed = MORE_AGENTS.filter((name) => !props.providers.some((p) => p.label === name));
  return (
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
            <ItemMedia variant="icon" className={ready ? "" : "opacity-50 grayscale"}>
              <ProviderLogo provider={p.id} />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="gap-1.5">
                {p.label}
                <StatusBadge status={p.status} />
              </ItemTitle>
              <ItemDescription className="text-xs">
                {ready ? providerMeta(p, props.preferred) : (p.message ?? "")}
              </ItemDescription>
            </ItemContent>
            <ItemFooter>
              {ready ? (
                <StartButton {...props} provider={p} />
              ) : (
                <Button size="sm" variant="outline" className="w-full" onClick={props.onCheckAgain}>
                  <RotateCw size={14} aria-hidden />
                  Check again
                </Button>
              )}
            </ItemFooter>
          </Item>
        );
      })}
      {notYetListed.length > 0 ? (
        <Item size="xs" className="text-muted-foreground">
          <ItemMedia variant="icon">
            <Plug size={14} aria-hidden />
          </ItemMedia>
          <ItemContent>
            <ItemTitle className="text-xs font-normal text-muted-foreground">
              {notYetListed.join(", ")} and other agents that speak ACP appear here once installed
            </ItemTitle>
          </ItemContent>
        </Item>
      ) : null}
    </ItemGroup>
  );
}

/**
 * Once an agent has been used: one row per agent under "New session", so the
 * sessions above stay in view with every agent installed.
 */
function ProviderRows(props: PickerProps) {
  return (
    <ItemGroup
      className="gap-0 rounded-lg border border-border bg-background has-data-[size=xs]:gap-0"
      aria-label="Agents on this computer"
    >
      {props.providers.map((p, n) => {
        const ready = p.status === "ready";
        return (
          <Fragment key={p.id}>
            {n > 0 ? <ItemSeparator className="my-0" /> : null}
            <Item size="xs" className="rounded-none" data-agent-provider={p.id}>
              <ItemMedia variant="icon" className={ready ? "" : "opacity-50 grayscale"}>
                <ProviderLogo provider={p.id} size={14} />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0.5">
                <ItemTitle className="w-full min-w-0 gap-1.5 text-xs">
                  <span className="truncate">{p.label}</span>
                  {ready ? (
                    p.id === props.preferred ? (
                      <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                        Last used
                      </span>
                    ) : null
                  ) : (
                    <StatusBadge status={p.status} />
                  )}
                </ItemTitle>
                {!ready && p.message ? (
                  <ItemDescription className="text-[11px]">{p.message}</ItemDescription>
                ) : null}
              </ItemContent>
              <ItemActions>
                {ready ? (
                  <StartButton {...props} provider={p} compact />
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Check again for ${p.label}`}
                    onClick={props.onCheckAgain}
                  >
                    <RotateCw aria-hidden />
                    Check again
                  </Button>
                )}
              </ItemActions>
            </Item>
          </Fragment>
        );
      })}
    </ItemGroup>
  );
}

function RecentSessions(
  props: Pick<AgentStartProps, "providers" | "recent" | "onOpen" | "onReopen">,
) {
  const [all, setAll] = useState(false);
  const shown = all ? props.recent : props.recent.slice(0, RECENT_SHOWN);
  const hidden = props.recent.length - RECENT_SHOWN;
  return (
    <section className="flex flex-col gap-1" aria-label="Recent sessions">
      <h3 className="px-1 text-[11px] font-medium text-muted-foreground">Recent sessions</h3>
      <ItemGroup className="gap-0 has-data-[size=xs]:gap-0">
        {shown.map((s) => (
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
                <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px] font-normal">
                  <ProviderLogo provider={s.provider} size={10} />
                  {/* Until the agents are known, the mark alone says which: an id like
                      claude-code would flash before its name replaced it. */}
                  {props.providers?.find((p) => p.id === s.provider)?.label ?? (
                    <span className="sr-only">{s.provider}</span>
                  )}
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
      {hidden > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          className="self-start text-muted-foreground"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${props.recent.length}`}
        </Button>
      ) : null}
    </section>
  );
}

/**
 * Sessions an agent ran for this app from a terminal or an editor, offered to
 * continue here: the agent picks up where it left off, and the tab shows what
 * was said before.
 */
function ContinueSessions(props: {
  providers: AgentProviderInfo[];
  starting: string | null;
  loadHistory: (provider: string) => Promise<AgentHistoryEntry[]>;
  onResume: (provider: string, providerSessionId: string) => void;
}) {
  const [open, setOpen] = useState<AgentProviderInfo | null>(null);
  const [entries, setEntries] = useState<AgentHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loadHistory } = props;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setEntries(null);
    setError(null);
    loadHistory(open.id).then(
      (list) => live && setEntries(list),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [open, loadHistory]);
  const able = props.providers.filter((p) => p.status === "ready" && p.capabilities.history);
  if (able.length === 0) return null;
  return (
    <section className="flex flex-col gap-1" aria-label="Continue a session">
      <h3 className="px-1 text-[11px] font-medium text-muted-foreground">
        Continue from your terminal
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {able.map((p) => (
          <Button
            key={p.id}
            size="xs"
            variant="outline"
            disabled={props.starting !== null}
            onClick={() => setOpen(p)}
          >
            <History aria-hidden />
            {p.label} sessions
          </Button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Continue a {open?.label} session</DialogTitle>
            <DialogDescription>
              Sessions {open?.label} ran in this app's folder outside the canvas. The one you pick
              carries on here, with what was said before.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : entries === null ? (
            <div className="flex flex-col gap-2" role="status" aria-label="Looking for sessions">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other {open?.label} sessions for this app. Sessions started in another folder can't
              be continued here.
            </p>
          ) : (
            <ItemGroup className="max-h-80 gap-0 overflow-y-auto has-data-[size=xs]:gap-0">
              {entries.map((e) => (
                <Item key={e.providerSessionId} size="xs" className="px-1">
                  <ItemContent className="min-w-0 gap-0.5">
                    <ItemTitle className="w-full min-w-0 text-xs">
                      <span className="truncate">{e.title}</span>
                    </ItemTitle>
                    <ItemDescription className="text-[11px]">{ago(e.updatedAt)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      size="xs"
                      variant="outline"
                      aria-label={`Continue ${e.title}`}
                      onClick={() => {
                        if (!open) return;
                        props.onResume(open.id, e.providerSessionId);
                        setOpen(null);
                      }}
                    >
                      Continue
                    </Button>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * No session open: go back to one this design already has, or pick an agent.
 * Someone who has used an agent here sees their sessions first and the agents
 * as one row each; someone who hasn't sees the agents as cards that explain
 * themselves.
 */
export function AgentStart(props: AgentStartProps) {
  // One agent is the obvious start — the one used last, else the first ready —
  // and it leads the list, so the highlighted button is always the top one.
  const providers = [...(props.providers ?? [])].sort(
    (a, b) => Number(b.id === props.preferred) - Number(a.id === props.preferred),
  );
  const returning = props.recent.length > 0;
  const picker: PickerProps = {
    providers,
    preferred: props.preferred,
    primary: providers.find((p) => p.status === "ready")?.id,
    starting: props.starting,
    onStart: props.onStart,
    onCheckAgain: props.onCheckAgain,
  };
  const agents =
    props.providers === null ? (
      props.loadError ? (
        <Empty className="flex-none gap-3 border border-dashed p-4" data-agent-load-error>
          <EmptyHeader className="gap-1">
            <EmptyTitle className="text-xs">Couldn't look for agents</EmptyTitle>
            <EmptyDescription className="text-[11px] break-words">
              {props.loadError}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" variant="outline" onClick={props.onRetry}>
              <RotateCw size={14} aria-hidden />
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ProviderSkeletons compact={returning} />
      )
    ) : providers.length === 0 ? (
      <Empty className="flex-none gap-3 border border-dashed p-4" data-agent-none>
        <EmptyHeader className="gap-1">
          <EmptyTitle className="text-xs">No agents on this computer</EmptyTitle>
          <EmptyDescription className="text-[11px]">
            Install Codex, Claude Code or an agent that speaks ACP ({MORE_AGENTS.join(", ")}), then
            check again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={props.onCheckAgain}>
            <RotateCw size={14} aria-hidden />
            Check again
          </Button>
        </EmptyContent>
      </Empty>
    ) : returning ? (
      <ProviderRows {...picker} />
    ) : (
      <ProviderCards {...picker} />
    );
  const resume =
    props.providers && props.loadHistory && props.onResume ? (
      <ContinueSessions
        providers={props.providers}
        starting={props.starting}
        loadHistory={props.loadHistory}
        onResume={props.onResume}
      />
    ) : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-agent-start>
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-3 ${returning ? "gap-4 py-3" : "gap-5 py-6"}`}
      >
        {returning ? (
          <>
            <RecentSessions {...props} />
            <section className="flex flex-col gap-1" aria-label="New session">
              <h3 className="px-1 text-[11px] font-medium text-muted-foreground">New session</h3>
              {agents}
            </section>
            {resume}
          </>
        ) : (
          <>
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
            {agents}
            {resume}
          </>
        )}
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
