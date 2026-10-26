import type { AgentMcpAction, AgentMcpServer, AgentSessionControls } from "@velloo/protocol/agent";
import { Check, Plug, RotateCw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { Switch } from "../ui/switch.tsx";

/** The commands Velloo answers itself, with panels, rather than sending to the agent. */
export type VellooCommand = "model" | "mcp";

export interface SlashEntry {
  name: string;
  description?: string | undefined;
  argumentHint?: string | undefined;
  /** Velloo opens a panel for it; otherwise it's sent to the agent as `/name`. */
  velloo?: VellooCommand;
}

/** The command being typed: the text is `/` and one word, nothing after it yet. */
export function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text);
  return match ? (match[1] ?? "").toLowerCase() : null;
}

/**
 * What the slash menu offers for `query`: `/model` and `/mcp` when the
 * session can do them, then the agent's own commands — names that start with
 * the query first, then ones that merely contain it.
 */
export function slashEntries(
  controls: AgentSessionControls | undefined,
  query: string,
  modelLabel?: string,
): SlashEntry[] {
  if (!controls) return [];
  const ours: SlashEntry[] = [];
  if (controls.models.length > 0) {
    ours.push({
      name: "model",
      description: modelLabel ? `Switch the model (now ${modelLabel})` : "Switch the model",
      velloo: "model",
    });
  }
  if (controls.mcp) {
    ours.push({ name: "mcp", description: "See the agent's MCP servers", velloo: "mcp" });
  }
  const taken = new Set(ours.map((e) => e.name));
  const all = [...ours, ...controls.commands.filter((c) => !taken.has(c.name))];
  const starts = all.filter((e) => e.name.toLowerCase().startsWith(query));
  const contains = all.filter(
    (e) => !e.name.toLowerCase().startsWith(query) && e.name.toLowerCase().includes(query),
  );
  return [...starts, ...contains];
}

/** The menu over the prompt box while a command is typed. Driven from the textarea's keys. */
export function SlashMenu({
  id,
  entries,
  active,
  onPick,
  onHover,
}: {
  id: string;
  entries: SlashEntry[];
  active: number;
  onPick(entry: SlashEntry): void;
  onHover(index: number): void;
}) {
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Commands"
      className="max-h-56 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      data-agent-slash-menu
    >
      {entries.map((entry, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the textarea keeps focus and drives the keys.
        <div
          key={entry.name}
          id={`${id}-${i}`}
          role="option"
          tabIndex={-1}
          aria-selected={i === active}
          className={`flex cursor-default flex-col gap-0.5 rounded-sm px-2 py-1.5 text-xs ${
            i === active ? "bg-accent text-accent-foreground" : ""
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => onHover(i)}
          onClick={() => onPick(entry)}
        >
          <span className="flex items-center gap-1.5">
            <span className="font-medium">/{entry.name}</span>
            {entry.argumentHint ? (
              <span className="text-muted-foreground">{entry.argumentHint}</span>
            ) : null}
            {entry.velloo ? (
              <Badge variant="outline" className="ml-auto h-4 px-1.5 text-[10px] font-normal">
                Velloo
              </Badge>
            ) : null}
          </span>
          {entry.description ? (
            <span className="line-clamp-2 text-[11px] text-muted-foreground">
              {entry.description}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ControlPanel({
  title,
  onClose,
  actions,
  children,
  footer,
}: {
  title: string;
  onClose(): void;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex max-h-72 flex-col rounded-md border bg-popover text-popover-foreground shadow-sm"
      data-agent-control={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <header className="flex items-center gap-1 border-b px-2 py-1.5">
        <h3 className="flex-1 text-xs font-medium">{title}</h3>
        {actions}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <X size={12} aria-hidden />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">{children}</div>
      {footer ? (
        <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">{footer}</p>
      ) : null}
    </section>
  );
}

/** `/model`: the models the session can switch to, the current one checked. */
export function ModelPanel({
  controls,
  providerLabel,
  onPick,
  onClose,
}: {
  controls: AgentSessionControls;
  providerLabel: string;
  onPick(model: string): Promise<boolean>;
  onClose(): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // Opened from the keyboard, so the choice takes focus: the current model.
  useEffect(() => {
    const radios = list.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    const current = list.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (current ?? radios?.[0])?.focus();
  }, []);
  return (
    <ControlPanel
      title="Model"
      onClose={onClose}
      footer={`${providerLabel} uses it from your next message.`}
    >
      <div ref={list} role="radiogroup" aria-label="Model" className="flex flex-col">
        {controls.models.map((option) => {
          const current = option.id === controls.model;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a row with a description, styled as the menu's.
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={current}
              disabled={busy !== null}
              className="flex items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-60"
              onClick={async () => {
                if (current) return onClose();
                setBusy(option.id);
                const done = await onPick(option.id);
                setBusy(null);
                if (done) onClose();
              }}
            >
              <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                {busy === option.id ? (
                  <Spinner className="size-3 motion-reduce:animate-none" />
                ) : current ? (
                  <Check size={14} aria-hidden />
                ) : null}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </ControlPanel>
  );
}

const MCP_STATUS: Record<AgentMcpServer["status"], { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-emerald-500" },
  starting: { label: "Starting", dot: "bg-amber-500" },
  "needs-auth": { label: "Needs sign-in", dot: "bg-amber-500" },
  failed: { label: "Failed", dot: "bg-destructive" },
  disabled: { label: "Off", dot: "bg-muted-foreground/50" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/50" },
};

/**
 * `/mcp`: the agent's MCP servers as the agent sees them — its own, plus the
 * one Velloo added for this design — with what this session can do to each.
 */
export function McpPanel({
  providerLabel,
  actions,
  load,
  act,
  onClose,
}: {
  providerLabel: string;
  actions: AgentMcpAction[];
  load(): Promise<AgentMcpServer[] | null>;
  act(server: string, action: AgentMcpAction): Promise<boolean>;
  onClose(): void;
}) {
  const [servers, setServers] = useState<AgentMcpServer[] | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => setServers(await load()), [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const run = async (server: string, action: AgentMcpAction) => {
    setBusy(server);
    if (await act(server, action)) await refresh();
    setBusy(null);
  };
  const sorted = servers
    ? [...servers].sort((a, b) => Number(Boolean(b.velloo)) - Number(Boolean(a.velloo)))
    : servers;
  return (
    <ControlPanel
      title="MCP servers"
      onClose={onClose}
      actions={
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label="Check the servers again"
          disabled={servers === undefined}
          onClick={() => {
            setServers(undefined);
            void refresh();
          }}
        >
          <RotateCw size={12} aria-hidden />
        </Button>
      }
      footer={`From ${providerLabel}'s own settings, plus the one Velloo adds for this design.`}
    >
      {sorted === undefined ? (
        <div className="flex justify-center p-3">
          <Spinner className="size-4 motion-reduce:animate-none" />
        </div>
      ) : sorted === null ? (
        <p className="p-2 text-xs text-muted-foreground">Couldn't read the servers.</p>
      ) : sorted.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No MCP servers.</p>
      ) : (
        <ul className="flex flex-col">
          {sorted.map((server) => {
            const status = MCP_STATUS[server.status];
            const off = server.status === "disabled";
            return (
              <li
                key={server.name}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
                data-mcp-server={server.name}
              >
                <Plug size={12} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{server.name}</span>
                    {server.velloo ? (
                      <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                        This design
                      </Badge>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden />
                    <span className="shrink-0 whitespace-nowrap">{status.label}</span>
                    {server.tools && server.status === "connected" ? (
                      <span className="shrink-0 whitespace-nowrap">
                        · {server.tools} {server.tools === 1 ? "tool" : "tools"}
                      </span>
                    ) : null}
                    {server.detail ? <span className="truncate">· {server.detail}</span> : null}
                  </span>
                </span>
                {busy === server.name ? (
                  <Spinner className="size-3 motion-reduce:animate-none" />
                ) : (
                  <>
                    {actions.includes("reconnect") && !off ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        aria-label={`Reconnect ${server.name}`}
                        title="Reconnect"
                        onClick={() => void run(server.name, "reconnect")}
                      >
                        <RotateCw size={12} aria-hidden />
                      </Button>
                    ) : null}
                    {actions.includes(off ? "enable" : "disable") && !server.velloo ? (
                      <Switch
                        size="sm"
                        checked={!off}
                        aria-label={`${server.name} on for this session`}
                        onCheckedChange={(on) => void run(server.name, on ? "enable" : "disable")}
                      />
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </ControlPanel>
  );
}
