/**
 * The agent conversation, drawn from the agent contract alone.
 *
 * Nothing here imports the store or the API: it renders turns, items and
 * approvals it is handed and reports what the person did through callbacks.
 * That is what lets the hosted design agent render through the same pieces —
 * a cloud run produces the same turns — and what keeps these testable as
 * plain components.
 */
import type {
  AgentApprovalDecision,
  AgentApprovalRequest,
  AgentContextCard,
  AgentItem,
  AgentTurn,
} from "@velloo/protocol/agent";
import {
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleX,
  FilePenLine,
  Info,
  ListChecks,
  Pause,
  PenTool,
  Send,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { type KeyboardEvent, memo, type ReactNode, useState } from "react";
import { Badge } from "../ui/badge.tsx";
import { Bubble, BubbleContent } from "../ui/bubble.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { Kbd, KbdGroup } from "../ui/kbd.tsx";
import { Message, MessageContent, MessageFooter, MessageHeader } from "../ui/message.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { AgentText } from "./agent-text.tsx";
import { CommentCard, ContextChip } from "./context-cards.tsx";
import { ProviderLogo } from "./provider-logo.tsx";

/** Where a canvas target lives, for "Show on canvas". */
export interface CanvasTarget {
  boardId?: string;
  screenId?: string;
  frameId?: string;
  path?: string;
}

/** What the container knows about a comment the person sent, to offer resolving it. */
export type SentCommentState = "open" | "resolved" | "gone";

export interface ConversationCallbacks {
  /** The session's working directory: paths inside it are shown relative to it. */
  cwd?: string | undefined;
  onReveal?: (target: CanvasTarget) => void;
  onResolveComment?: (threadId: string) => void;
  commentState?: (threadId: string) => SentCommentState | undefined;
}

const VELLOO_SERVER = "velloo";
/** The guided surface's tools, which carry the operation they run in their arguments. */
const FACADES = new Set(["read_velloo", "call_velloo", "run_velloo_plan"]);
const READ_ONLY =
  /^(get_|list_|find_|inspect|screenshot|compare_to_url|emit_|render_snippet|preview_status|check_components|score_|component_status|operation_schema)/;

/** The Velloo operation a tool call ran: the tool itself, or what `call_velloo` was asked to run. */
function vellooOperation(item: Extract<AgentItem, { kind: "tool" }>): string | null {
  if (item.server !== VELLOO_SERVER) return null;
  if (FACADES.has(item.name)) {
    return item.input?.match(/"operation"\s*:\s*"([^"]+)"/)?.[1] ?? item.name;
  }
  return item.name;
}

/** The canvas object a Velloo call touched, read from its arguments. */
export function canvasTargetOf(item: AgentItem): CanvasTarget | null {
  if (item.kind !== "tool" || item.server !== VELLOO_SERVER || !item.input) return null;
  const read = (key: string) => item.input?.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
  const target: CanvasTarget = {};
  const screenId = read("screenId");
  const boardId = read("boardId");
  const frameId = read("frameId");
  if (screenId) target.screenId = screenId;
  if (boardId) target.boardId = boardId;
  if (frameId) target.frameId = frameId;
  return screenId || boardId ? target : null;
}

/** Where a context card points, for "Show on canvas". */
export function targetOfCard(card: AgentContextCard): CanvasTarget {
  const { boardId, screenId, frameId, path } = card.ref;
  return {
    ...(boardId ? { boardId } : {}),
    ...(screenId ? { screenId } : {}),
    ...(frameId ? { frameId } : {}),
    ...(path !== undefined ? { path } : {}),
  };
}

/**
 * A call that changes the design. `read_velloo` only ever reads; any other
 * tool is judged by the operation it ran, which also keeps a read sent through
 * an older daemon's all-purpose `call_velloo` from counting as an edit.
 */
const isDesignEdit = (item: AgentItem) => {
  if (item.kind !== "tool") return false;
  const op = vellooOperation(item);
  if (op === null || item.name === "read_velloo") return false;
  return !READ_ONLY.test(op);
};

const WORK = new Set<AgentItem["kind"]>([
  "command",
  "file-change",
  "tool",
  "subagent",
  "reasoning",
  "plan",
]);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Ran 3 commands · edited 2 files · 4 design edits" */
export function workSummary(items: AgentItem[]): string {
  const commands = items.filter((i) => i.kind === "command" && i.status !== "declined").length;
  const declined = items.filter((i) => "status" in i && i.status === "declined").length;
  const files = new Set(
    items.flatMap((i) =>
      i.kind === "file-change" && i.status !== "declined" ? i.changes.map((c) => c.path) : [],
    ),
  ).size;
  const edits = items.filter(isDesignEdit).length;
  const reads = items.filter(
    (i) => i.kind === "tool" && vellooOperation(i) !== null && !isDesignEdit(i),
  ).length;
  const tools = items.filter((i) => i.kind === "tool" && vellooOperation(i) === null).length;
  const agents = items.filter((i) => i.kind === "subagent").length;
  const parts = [
    commands && `Ran ${plural(commands, "command")}`,
    files && `edited ${plural(files, "file")}`,
    edits && plural(edits, "design edit"),
    reads && !edits && "looked at the design",
    tools && `used ${plural(tools, "tool")}`,
    agents && plural(agents, "subagent"),
    declined && `${declined} declined`,
  ].filter(Boolean) as string[];
  const text = parts.join(" · ") || "Thought it through";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A path as the person thinks of it: relative to the working directory when inside it. */
function shownPath(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(`${cwd.replace(/\/$/, "")}/`))
    return path.slice(cwd.replace(/\/$/, "").length + 1);
  return homePath(path);
}

/** `/Users/ana/acme/web` → `~/acme/web`: the part of a path that says where. */
export function homePath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function diffStats(diff: string | undefined): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff?.split("\n") ?? []) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

/** What a running step is doing, as the line under a working turn. */
function liveLabel(item: AgentItem, cwd: string | undefined): ReactNode {
  switch (item.kind) {
    case "command":
      return (
        <>
          Running <span className="font-mono">{item.command}</span>
        </>
      );
    case "file-change":
      return (
        <>
          Editing{" "}
          <span className="font-mono">
            {item.changes[0] ? shownPath(item.changes[0].path, cwd) : "a file"}
          </span>
        </>
      );
    case "tool": {
      const op = vellooOperation(item);
      return op ? `Editing the design (${op})` : `Using ${item.name}`;
    }
    case "subagent":
      return `Subagent: ${item.description}`;
    case "reasoning":
      return "Thinking";
    default:
      return "Working";
  }
}

// ── steps ──────────────────────────────────────────────────────────────────

const STEP_ROW = "flex flex-col gap-1.5 px-2.5 py-2 [&+&]:border-t [&+&]:border-border";

function StatusBadge({ item }: { item: Extract<AgentItem, { kind: "command" }> }) {
  if (item.status === "running")
    return <Spinner className="size-3 shrink-0 motion-reduce:animate-none" aria-label="Running" />;
  if (item.status === "declined") {
    return (
      <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
        Declined
      </Badge>
    );
  }
  const failed = item.status === "failed";
  return (
    <Badge
      variant={failed ? "destructive" : "secondary"}
      className="h-4 gap-0.5 px-1.5 font-mono text-[10px]"
    >
      {failed ? <CircleX size={10} /> : <Check size={10} />}
      {item.exitCode !== undefined && item.exitCode !== null
        ? `exit ${item.exitCode}`
        : failed
          ? "failed"
          : "done"}
    </Badge>
  );
}

function CommandStep({ item }: { item: Extract<AgentItem, { kind: "command" }> }) {
  const [open, setOpen] = useState(false);
  const lines = item.output.trimEnd().split("\n").filter(Boolean);
  return (
    <div className={STEP_ROW} data-agent-step="command">
      <div className="flex items-center gap-2">
        <SquareTerminal size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={item.command}>
          {item.command}
        </span>
        <StatusBadge item={item} />
      </div>
      {lines.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide output" : "Show output"}
          className="ml-[22px] flex flex-col overflow-hidden rounded-md bg-muted px-2 py-1.5 text-left font-mono text-[10.5px] leading-relaxed text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">
              {item.outputDropped
                ? `… ${item.outputDropped.toLocaleString()} characters earlier\n`
                : ""}
              {item.output}
            </pre>
          ) : (
            lines.slice(-2).map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: preview lines of one output
              <span key={i} className="truncate">
                {line}
              </span>
            ))
          )}
        </button>
      ) : null}
    </div>
  );
}

function DiffLines({ diff, limit }: { diff: string; limit?: number }) {
  const lines = diff.split("\n").filter((l) => !l.startsWith("+++") && !l.startsWith("---"));
  const shown = limit
    ? lines.filter((l) => l.startsWith("+") || l.startsWith("-")).slice(0, limit)
    : lines;
  return (
    <>
      {shown.map((line, i) => {
        const add = line.startsWith("+");
        const del = line.startsWith("-");
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one diff
            key={i}
            className={`block truncate px-2 ${add ? "bg-accent text-accent-foreground" : del ? "bg-muted text-muted-foreground" : "text-muted-foreground"}`}
          >
            {add ? "+  " : del ? "−  " : "   "}
            {line.slice(add || del || line.startsWith(" ") ? 1 : 0)}
          </span>
        );
      })}
    </>
  );
}

function FileStep({
  item,
  cwd,
}: {
  item: Extract<AgentItem, { kind: "file-change" }>;
  cwd?: string | undefined;
}) {
  return (
    <>
      {item.changes.map((change) => (
        <FileChangeRow key={change.path} change={change} status={item.status} cwd={cwd} />
      ))}
    </>
  );
}

function FileChangeRow({
  change,
  status,
  cwd,
}: {
  change: Extract<AgentItem, { kind: "file-change" }>["changes"][number];
  status: Extract<AgentItem, { kind: "file-change" }>["status"];
  cwd?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const { added, removed } = diffStats(change.diff);
  return (
    <div className={STEP_ROW} data-agent-step="file-change">
      <div className="flex items-center gap-2">
        <FilePenLine size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={change.path}>
          {shownPath(change.path, cwd)}
        </span>
        {status === "running" ? (
          <Spinner className="size-3 shrink-0 motion-reduce:animate-none" />
        ) : null}
        {status === "declined" ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            Declined
          </Badge>
        ) : change.change === "add" ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            New
          </Badge>
        ) : change.change === "delete" ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            Deleted
          </Badge>
        ) : null}
        {added || removed ? (
          <>
            <span className="shrink-0 font-mono text-[11px] tabular-nums">+{added}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              −{removed}
            </span>
          </>
        ) : null}
      </div>
      {change.diff ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Hide the diff of ${change.path}` : `Show the diff of ${change.path}`}
          className="ml-[22px] flex flex-col overflow-hidden rounded-md border border-border text-left font-mono text-[10.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <span className="block max-h-72 overflow-auto">
              <DiffLines diff={change.diff} />
              {change.diffTruncated ? (
                <span className="block px-2 text-muted-foreground">… diff cut short</span>
              ) : null}
            </span>
          ) : (
            <DiffLines diff={change.diff} limit={3} />
          )}
        </button>
      ) : null}
    </div>
  );
}

function ToolStep({
  item,
  onReveal,
}: {
  item: Extract<AgentItem, { kind: "tool" }>;
  onReveal?: ((target: CanvasTarget) => void) | undefined;
}) {
  const op = vellooOperation(item);
  const target = canvasTargetOf(item);
  const where = target?.screenId ?? target?.boardId;
  return (
    <div className={STEP_ROW} data-agent-step="tool">
      <div className="flex items-center gap-2">
        {op ? (
          <PenTool size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <Wrench size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-[11px]" title={item.input}>
          <span className="font-mono">
            {op ? `velloo.${op}` : item.server ? `${item.server}.${item.name}` : item.name}
          </span>
          {where
            ? ` — ${where}`
            : !op && item.input && !item.input.startsWith("{")
              ? ` — ${item.input}`
              : ""}
        </span>
        {item.status === "running" ? (
          <Spinner className="size-3 shrink-0 motion-reduce:animate-none" />
        ) : null}
        {item.status === "failed" ? (
          <CircleX size={12} className="shrink-0 text-destructive" aria-label="Failed" />
        ) : null}
      </div>
      {item.status === "failed" && item.output ? (
        <span className="ml-[22px] line-clamp-2 text-[11px] text-muted-foreground">
          {item.output}
        </span>
      ) : null}
      {target && onReveal && item.status !== "failed" ? (
        <Button
          variant="link"
          size="xs"
          className="ml-[22px] h-5 w-fit px-0 text-[11px] text-accent-foreground"
          onClick={() => onReveal(target)}
        >
          Show on canvas
          <ArrowUpRight size={12} />
        </Button>
      ) : null}
    </div>
  );
}

function OtherStep({ item }: { item: AgentItem }) {
  if (item.kind === "subagent") {
    return (
      <div className={STEP_ROW} data-agent-step="subagent">
        <div className="flex items-center gap-2">
          <Bot size={14} className="shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[11px]">{item.description}</span>
          {item.status === "running" ? (
            <Spinner className="size-3 shrink-0 motion-reduce:animate-none" />
          ) : null}
        </div>
      </div>
    );
  }
  if (item.kind === "reasoning") {
    if (!item.text.trim()) return null;
    return (
      <div className={STEP_ROW} data-agent-step="reasoning">
        <div className="flex items-start gap-2">
          <Brain size={14} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 line-clamp-3 text-[11px] text-muted-foreground italic">
            {item.text}
          </span>
        </div>
      </div>
    );
  }
  if (item.kind === "plan") return <PlanSteps item={item} />;
  return null;
}

function PlanSteps({ item }: { item: Extract<AgentItem, { kind: "plan" }> }) {
  return (
    <div className={STEP_ROW} data-agent-step="plan">
      <div className="flex items-center gap-2 text-[11px] font-medium">
        <ListChecks size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        Plan
      </div>
      <ul className="ml-[22px] flex flex-col gap-0.5 text-[11px]">
        {item.steps.map((step, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: plan steps are positional
          <li key={i} className="flex items-start gap-1.5">
            {step.status === "completed" ? (
              <Check
                size={12}
                className="mt-0.5 shrink-0 text-muted-foreground"
                aria-label="Done"
              />
            ) : step.status === "in-progress" ? (
              <Spinner
                className="mt-0.5 size-3 shrink-0 motion-reduce:animate-none"
                aria-label="In progress"
              />
            ) : (
              <span
                className="mt-1 size-2 shrink-0 rounded-full border border-muted-foreground/60"
                role="img"
                aria-label="To do"
              />
            )}
            <span
              className={step.status === "completed" ? "text-muted-foreground line-through" : ""}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({
  item,
  onReveal,
  cwd,
}: {
  item: AgentItem;
  onReveal?: ((target: CanvasTarget) => void) | undefined;
  cwd?: string | undefined;
}) {
  switch (item.kind) {
    case "command":
      return <CommandStep item={item} />;
    case "file-change":
      return <FileStep item={item} cwd={cwd} />;
    case "tool":
      return <ToolStep item={item} onReveal={onReveal} />;
    default:
      return <OtherStep item={item} />;
  }
}

const STEP_LIMIT = 5;

/** A run of work, folded into one line until the person opens it. */
function WorkSummary({
  items,
  running,
  onReveal,
  cwd,
}: {
  items: AgentItem[];
  running: boolean;
  onReveal?: ((target: CanvasTarget) => void) | undefined;
  cwd?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const visible = items.filter((i) => i.kind !== "reasoning" || i.text.trim());
  const shown = all ? visible : visible.slice(-STEP_LIMIT);
  const hidden = visible.length - shown.length;
  const live = running
    ? [...items].reverse().find((i) => "status" in i && i.status === "running")
    : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="overflow-hidden rounded-lg border border-border bg-background"
        data-agent-work
      >
        <CollapsibleTrigger className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ListChecks size={14} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1">{workSummary(items)}</span>
          {open ? (
            <ChevronDown size={14} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight size={14} className="mt-px shrink-0 text-muted-foreground" aria-hidden />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col border-t border-border">
          {hidden > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              className="h-7 w-full justify-start rounded-none border-b border-border px-2.5 text-[11px] font-normal text-muted-foreground"
              onClick={() => setAll(true)}
            >
              Show {plural(hidden, "earlier step")}
            </Button>
          ) : null}
          {shown.map((item) => (
            <Step key={item.id} item={item} onReveal={onReveal} cwd={cwd} />
          ))}
        </CollapsibleContent>
      </Collapsible>
      {live ? (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5 shrink-0 motion-reduce:animate-none" aria-hidden />
          <span className="truncate">{liveLabel(live, cwd)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ── turns ──────────────────────────────────────────────────────────────────

type Segment =
  | { kind: "text"; item: AgentItem }
  | { kind: "work"; items: AgentItem[] }
  | { kind: "notice"; item: AgentItem };

/** An agent's part of a turn as the reader meets it: what it said, the work between, and notices. */
export function segmentsOf(items: AgentItem[]): Segment[] {
  const out: Segment[] = [];
  for (const item of items) {
    if (item.kind === "user") continue;
    if (WORK.has(item.kind)) {
      const last = out.at(-1);
      if (last?.kind === "work") last.items.push(item);
      else out.push({ kind: "work", items: [item] });
    } else if (item.kind === "notice") out.push({ kind: "notice", item });
    else if (item.kind === "agent-text" && item.text.trim()) out.push({ kind: "text", item });
  }
  return out;
}

function Notice({ item }: { item: Extract<AgentItem, { kind: "notice" }> }) {
  const Icon =
    item.level === "error" ? CircleAlert : item.level === "warning" ? TriangleAlert : Info;
  return (
    <div
      className={`flex items-start gap-1.5 text-xs ${item.level === "error" ? "text-destructive" : "text-muted-foreground"}`}
      role={item.level === "error" ? "alert" : undefined}
    >
      <Icon size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0">{item.text}</span>
    </div>
  );
}

function UserMessage({
  item,
  callbacks,
  sentAt,
}: {
  item: Extract<AgentItem, { kind: "user" }>;
  callbacks: ConversationCallbacks;
  sentAt: string;
}) {
  const cards = item.context ?? [];
  const comments = cards.filter((c) => c.kind === "comment");
  const chips = cards.filter((c) => c.kind !== "comment");
  return (
    <Message align="end" data-agent-user>
      <MessageContent className="gap-1.5">
        {comments.length > 0 ? (
          <div className="ml-6 flex flex-col gap-1.5 self-stretch">
            {comments.map((card) => (
              <SentComment
                key={`${card.ref.threadId}:${card.ref.messageId}`}
                card={card}
                callbacks={callbacks}
              />
            ))}
          </div>
        ) : null}
        {item.text.trim() ? (
          <Bubble variant="secondary" align="end">
            <BubbleContent className="whitespace-pre-wrap">{item.text}</BubbleContent>
          </Bubble>
        ) : null}
        {chips.map((card) => (
          <ContextChip
            key={`${card.kind}:${card.label}`}
            card={card}
            variant="sent"
            onReveal={
              callbacks.onReveal && (card.ref.screenId || card.ref.boardId)
                ? () => callbacks.onReveal?.(targetOfCard(card))
                : undefined
            }
          />
        ))}
        {comments.length > 0 ? (
          <MessageFooter className="gap-1 font-normal">
            <Send size={11} aria-hidden />
            <span>
              Sent to agent · <RelativeAge iso={sentAt} />
            </span>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function SentComment({
  card,
  callbacks,
}: {
  card: AgentContextCard;
  callbacks: ConversationCallbacks;
}) {
  const threadId = card.ref.threadId ?? "";
  const state = callbacks.commentState?.(threadId);
  return (
    <CommentCard
      card={card}
      status={
        state === "resolved" ? (
          <Badge variant="secondary" className="ml-auto h-4 px-1.5 text-[10px]">
            Resolved
          </Badge>
        ) : state === "open" && callbacks.onResolveComment ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto h-5 gap-1 px-1.5 text-[11px]"
            onClick={() => callbacks.onResolveComment?.(threadId)}
            aria-label={`Resolve ${card.author ?? "the"} comment`}
          >
            <Check size={12} />
            Resolve
          </Button>
        ) : null
      }
    />
  );
}

function RelativeAge({ iso }: { iso: string }) {
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60_000);
  const text =
    m < 1
      ? "just now"
      : m < 60
        ? `${m}m`
        : m < 1440
          ? `${Math.round(m / 60)}h`
          : `${Math.round(m / 1440)}d`;
  return <time dateTime={iso}>{text}</time>;
}

function TurnFooter({ turn, waiting }: { turn: AgentTurn; waiting: boolean }) {
  if (turn.status === "running") {
    return waiting ? (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Pause size={12} className="shrink-0" aria-hidden />
        <span>Paused for your approval</span>
      </div>
    ) : null;
  }
  const took =
    turn.completedAt && turn.startedAt
      ? formatDuration(Date.parse(turn.completedAt) - Date.parse(turn.startedAt))
      : null;
  if (turn.status === "completed") {
    return (
      <MessageFooter className="gap-1.5 font-normal">
        <Check size={12} aria-hidden />
        <span>{took ? `Done in ${took}` : "Done"}</span>
      </MessageFooter>
    );
  }
  if (turn.status === "interrupted") {
    return (
      <MessageFooter className="gap-1.5 font-normal">
        <Pause size={12} aria-hidden />
        <span>Stopped</span>
      </MessageFooter>
    );
  }
  return (
    <MessageFooter className="items-start gap-1.5 font-normal text-destructive" role="alert">
      <CircleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span className="whitespace-normal">{turn.error ?? "This turn failed."}</span>
    </MessageFooter>
  );
}

export const TurnView = memo(function TurnView({
  turn,
  provider,
  providerLabel,
  waiting,
  callbacks,
}: {
  turn: AgentTurn;
  provider: string;
  providerLabel: string;
  waiting: boolean;
  callbacks: ConversationCallbacks;
}) {
  const users = turn.items.filter(
    (i): i is Extract<AgentItem, { kind: "user" }> => i.kind === "user",
  );
  const segments = segmentsOf(turn.items);
  const running = turn.status === "running";
  const quiet = running && segments.length === 0;
  return (
    <>
      {users.map((item) => (
        <UserMessage key={item.id} item={item} callbacks={callbacks} sentAt={turn.startedAt} />
      ))}
      <Message data-agent-turn={turn.status}>
        <MessageContent className="gap-2.5">
          {segments.length > 0 ? (
            <MessageHeader className="gap-1.5">
              <ProviderLogo provider={provider} size={12} />
              {providerLabel}
            </MessageHeader>
          ) : null}
          {segments.map((segment, i) =>
            segment.kind === "work" ? (
              <WorkSummary
                // biome-ignore lint/suspicious/noArrayIndexKey: a run of work is identified by its place in the turn
                key={`work-${i}`}
                items={segment.items}
                running={running && i === segments.length - 1}
                onReveal={callbacks.onReveal}
                cwd={callbacks.cwd}
              />
            ) : segment.kind === "notice" && segment.item.kind === "notice" ? (
              <Notice key={segment.item.id} item={segment.item} />
            ) : segment.item.kind === "agent-text" ? (
              <Bubble key={segment.item.id} variant="ghost">
                <BubbleContent>
                  <AgentText text={segment.item.text} />
                </BubbleContent>
              </Bubble>
            ) : null,
          )}
          {quiet && !waiting ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5 shrink-0 motion-reduce:animate-none" aria-hidden />
              <span>Thinking…</span>
            </div>
          ) : null}
          <TurnFooter turn={turn} waiting={waiting} />
        </MessageContent>
      </Message>
    </>
  );
});

// ── approvals ──────────────────────────────────────────────────────────────

const DECISION_LABEL: Record<AgentApprovalDecision, string> = {
  "allow-once": "Allow once",
  "allow-session": "Allow for this session",
  deny: "Deny",
  abort: "Deny and stop",
};

function approvalHeading(request: AgentApprovalRequest, providerLabel: string): string {
  switch (request.kind) {
    case "command":
      return `${providerLabel} wants to run a command`;
    case "file-change":
      return `${providerLabel} wants to change files`;
    case "permissions":
      return `${providerLabel} wants more access`;
    case "question":
      return `${providerLabel} has a question`;
    default:
      // A question in its own words ("Allow Computer Use to use Chrome?") is
      // shown as it is, under a heading that doesn't try to rephrase it.
      if (request.title.trim().endsWith("?")) return `${providerLabel} is asking`;
      return `${providerLabel} wants to ${request.title.charAt(0).toLowerCase()}${request.title.slice(1)}`;
  }
}

/**
 * An action waiting on the person. Offers exactly the decisions the provider
 * supports, names what would run and where, and answers to the keyboard while
 * focus is inside it — Enter allows once, ⌘/Ctrl+Enter for the session, Esc
 * denies — without taking focus from whatever the person is typing.
 */
export function ApprovalCard({
  request,
  providerLabel,
  onAnswer,
}: {
  request: AgentApprovalRequest;
  providerLabel: string;
  onAnswer: (decision: AgentApprovalDecision) => void;
}) {
  const [busy, setBusy] = useState(false);
  const has = (d: AgentApprovalDecision) => request.decisions.includes(d);
  const answer = (d: AgentApprovalDecision) => {
    if (busy || !has(d)) return;
    setBusy(true);
    onAnswer(d);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && has("deny")) {
      event.preventDefault();
      answer("deny");
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && has("allow-session")) {
      event.preventDefault();
      answer("allow-session");
    }
  };
  const titleId = `approval-${request.id}`;
  const Icon =
    request.kind === "file-change"
      ? FilePenLine
      : request.kind === "command"
        ? SquareTerminal
        : Wrench;
  return (
    <Card
      size="sm"
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="gap-3 bg-accent/60 ring-1 ring-primary dark:bg-accent"
      data-agent-approval={request.kind}
    >
      <CardHeader className="flex items-start gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon size={14} aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle id={titleId} className="text-sm">
            {approvalHeading(request, providerLabel)}
          </CardTitle>
          {request.reason ? (
            <CardDescription className="text-xs">{request.reason}</CardDescription>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {request.command ? (
          <div className="max-h-32 overflow-auto rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs break-all">
            {request.command}
          </div>
        ) : null}
        {request.paths?.length ? (
          <ul className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
            {request.paths.map((p) => (
              <li key={p} className="truncate" title={p}>
                {shownPath(p, request.cwd)}
              </li>
            ))}
          </ul>
        ) : null}
        {!request.command && request.input ? (
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap break-all">
            {request.input}
          </pre>
        ) : null}
        {request.kind !== "question" &&
        !request.command &&
        !request.input &&
        !request.paths?.length ? (
          <span className="text-xs">{request.title}</span>
        ) : null}
        {request.cwd ? (
          <span className="block truncate text-[11px] text-muted-foreground" title={request.cwd}>
            in <span className="font-mono">{homePath(request.cwd)}</span>
          </span>
        ) : null}
      </CardContent>
      <CardContent className="flex flex-col gap-1.5">
        {has("allow-once") ? (
          <Button
            size="sm"
            className="w-full justify-between"
            disabled={busy}
            onClick={() => answer("allow-once")}
          >
            <span>{DECISION_LABEL["allow-once"]}</span>
            <Kbd className="bg-primary-foreground/10 text-primary-foreground">↵</Kbd>
          </Button>
        ) : null}
        {has("allow-session") ? (
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-between bg-background"
            disabled={busy}
            onClick={() => answer("allow-session")}
          >
            <span>{DECISION_LABEL["allow-session"]}</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </KbdGroup>
          </Button>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          {has("deny") ? (
            <Button
              size="sm"
              variant="outline"
              className="justify-between bg-background"
              disabled={busy}
              onClick={() => answer("deny")}
            >
              <span>{request.kind === "question" ? "Skip" : DECISION_LABEL.deny}</span>
              <Kbd>Esc</Kbd>
            </Button>
          ) : null}
          {has("abort") ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              disabled={busy}
              onClick={() => answer("abort")}
            >
              {DECISION_LABEL.abort}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
