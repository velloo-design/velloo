import type { AgentContextCard, AgentSessionControls } from "@velloo/protocol/agent";
import { ArrowUp, ChevronDown, Clock, Frame, ShieldCheck, Square, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { contextKey } from "../../store/agent.ts";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../ui/input-group.tsx";
import { Kbd, KbdGroup } from "../ui/kbd.tsx";
import { type CardStaleness, CommentCard, ContextChip } from "./context-cards.tsx";
import {
  type SlashEntry,
  SlashMenu,
  slashEntries,
  slashQuery,
  type VellooCommand,
} from "./controls.tsx";

export interface ComposerProps {
  text: string;
  cards: AgentContextCard[];
  /** What is selected on the canvas, offered as a chip to attach. */
  selection?: AgentContextCard | null | undefined;
  /** The open board, its frames and its notes, for the attach menu. */
  attachable: AgentContextCard[];
  staleness: (card: AgentContextCard) => CardStaleness | undefined;
  providerLabel: string;
  /** A turn is running: sending steers or queues, and the action can stop it. */
  running: boolean;
  followUp: "steer" | "queue" | "none";
  queued: { id: string; text: string }[];
  disabled?: boolean;
  onText(text: string): void;
  onSend(): void;
  onStop(): void;
  onAttach(card: AgentContextCard): void;
  onRemove(card: AgentContextCard): void;
  onClearComments(): void;
  onDequeue(id: string): void;
  onReveal?: ((card: AgentContextCard) => void) | undefined;
  /** Where the person is, sent with the message unless they take it off. */
  view?: AgentContextCard | null | undefined;
  viewIncluded?: boolean | undefined;
  onViewIncluded?: ((included: boolean) => void) | undefined;
  /** What `/` offers: the agent's commands, and Velloo's `/model` and `/mcp`. */
  controls?: AgentSessionControls | undefined;
  /** The current model's name, for `/model`'s line in the menu. */
  modelLabel?: string | undefined;
  /** Open Velloo's panel for `/model` or `/mcp`. */
  onControl?: ((command: VellooCommand) => void) | undefined;
  /** What to call the current permission mode when it isn't one of `controls.modes`. */
  modeFallback?: string | undefined;
  onMode?: ((mode: string) => void) | undefined;
}

/**
 * The prompt box: context cards above it, comments as cards of their own, and
 * a send that becomes Stop while the agent works and nothing new is typed.
 * Cards alone are a complete message — the agent addresses the comments.
 */
export function AgentComposer(props: ComposerProps) {
  const { cards, attachable, running, providerLabel } = props;
  const attached = new Set(cards.map(contextKey));
  const selection =
    props.selection && !attached.has(contextKey(props.selection)) ? props.selection : null;
  const inputId = useId();
  const menuId = useId();
  const query = slashQuery(props.text);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const entries =
    query !== null && !dismissed ? slashEntries(props.controls, query, props.modelLabel) : [];
  const menuOpen = entries.length > 0;
  // A new word starts the menu over; clearing the slash forgets an Escape.
  useEffect(() => {
    setActive(0);
    if (query === null) setDismissed(false);
  }, [query]);
  const pick = (entry: SlashEntry) => {
    if (entry.velloo) {
      props.onText("");
      props.onControl?.(entry.velloo);
    } else props.onText(`/${entry.name} `);
  };
  const comments = cards.filter((c) => c.kind === "comment");
  const chips = cards.filter((c) => c.kind !== "comment");
  const hasDraft = props.text.trim().length > 0 || cards.length > 0;
  const canSend = hasDraft && !props.disabled && !(running && props.followUp === "none");
  const placeholder = comments.length
    ? "Add instructions, or send the comments on their own"
    : running
      ? props.followUp === "steer"
        ? `Reply to steer ${providerLabel}…`
        : `Queue a follow-up for ${providerLabel}…`
      : props.controls
        ? `Ask ${providerLabel}, or type / for commands`
        : `Ask ${providerLabel}…`;
  const send = () => {
    // `/model` and `/mcp` typed out in full are Velloo's, not the agent's.
    const typed = props.text.trim().slice(1);
    const ours = slashEntries(props.controls, typed).find((e) => e.velloo && e.name === typed);
    if (props.text.trim().startsWith("/") && ours) return pick(ours);
    if (canSend) props.onSend();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && !event.metaKey && !event.ctrlKey) {
      const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (move) {
        event.preventDefault();
        setActive((a) => (a + move + entries.length) % entries.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const entry = entries[Math.min(active, entries.length - 1)];
        if (entry) pick(entry);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    // Enter sends, as in every agent's own prompt; Shift+Enter is a new line.
    // Not while an input method is composing a character.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border p-3" data-agent-composer>
      {props.queued.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Queued messages">
          {props.queued.map((q) => (
            <li
              key={q.id}
              className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <Clock size={12} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Queued: {q.text || "comments"}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5 text-muted-foreground"
                onClick={() => props.onDequeue(q.id)}
                aria-label={`Remove queued message ${q.text}`}
              >
                <X size={12} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {comments.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label="Comments attached">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {comments.length} {comments.length === 1 ? "comment" : "comments"} attached
            </span>
            <Button
              variant="ghost"
              size="xs"
              className="h-5 px-1 text-[11px] font-normal text-muted-foreground"
              onClick={props.onClearComments}
            >
              Clear
            </Button>
          </div>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {comments.map((card) => (
              <li key={`${card.ref.threadId}:${card.ref.messageId}`}>
                <CommentCard
                  card={card}
                  stale={props.staleness(card)}
                  action={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      onClick={() => props.onRemove(card)}
                      aria-label={`Remove the comment by ${card.author ?? "someone"}`}
                    >
                      <X size={12} aria-hidden />
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {chips.length > 0 || selection || props.view ? (
        <fieldset className="flex flex-wrap items-center gap-1.5" aria-label="Context">
          {props.view ? (
            <ContextChip
              card={{ ...props.view, label: `Viewing ${props.view.label.split(" › ").pop()}` }}
              variant={props.viewIncluded ? "attached" : "suggested"}
              title={
                props.viewIncluded
                  ? `Sent with your message, so ${providerLabel} knows where you are on the canvas`
                  : `Tell ${providerLabel} where you are on the canvas`
              }
              onRemove={() => props.onViewIncluded?.(false)}
              onAdd={() => props.onViewIncluded?.(true)}
            />
          ) : null}
          {selection ? (
            <ContextChip
              card={selection}
              variant="suggested"
              title={`Add the selected ${selection.label.split(" › ").pop()} to your message`}
              onAdd={() => props.onAttach(selection)}
            />
          ) : null}
          {chips.map((card) => (
            <ContextChip
              key={`a:${card.kind}:${card.label}`}
              card={card}
              variant="attached"
              stale={props.staleness(card)}
              onRemove={() => props.onRemove(card)}
              onReveal={props.onReveal ? () => props.onReveal?.(card) : undefined}
            />
          ))}
        </fieldset>
      ) : null}
      {menuOpen ? (
        <SlashMenu
          id={menuId}
          entries={entries}
          active={Math.min(active, entries.length - 1)}
          onPick={pick}
          onHover={setActive}
        />
      ) : null}
      <InputGroup>
        <label htmlFor={inputId} className="sr-only">
          Message to {providerLabel}
        </label>
        <InputGroupTextarea
          id={inputId}
          className="max-h-48 min-h-16 text-sm"
          placeholder={placeholder}
          value={props.text}
          disabled={props.disabled}
          onChange={(e) => props.onText(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-activedescendant={
            menuOpen ? `${menuId}-${Math.min(active, entries.length - 1)}` : undefined
          }
        />
        <InputGroupAddon className="gap-1" align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton
                size="icon-xs"
                variant="ghost"
                aria-label="Attach frames from this board"
                title="Attach frames from this board"
              >
                <Frame size={14} aria-hidden />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
            >
              {attachable.length === 0 ? (
                <DropdownMenuItem disabled>Open a board to attach its frames</DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
                    Attach from this board
                  </DropdownMenuLabel>
                  {attachable.map((card, i) => {
                    const on = attached.has(contextKey(card));
                    const firstNote = card.kind === "note" && attachable[i - 1]?.kind !== "note";
                    return (
                      <div key={contextKey(card)} className="contents">
                        {firstNote || (card.kind === "frame" && i === 1) ? (
                          <DropdownMenuSeparator />
                        ) : null}
                        <DropdownMenuCheckboxItem
                          checked={on}
                          onSelect={(e) => {
                            e.preventDefault();
                            if (on) props.onRemove(card);
                            else props.onAttach(card);
                          }}
                        >
                          <span className="line-clamp-2">
                            {card.kind === "board" ? `The whole board · ${card.label}` : card.label}
                          </span>
                        </DropdownMenuCheckboxItem>
                      </div>
                    );
                  })}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {props.controls?.modes?.length ? (
            <ModeMenu
              modes={props.controls.modes}
              mode={props.controls.mode}
              fallback={props.modeFallback}
              providerLabel={providerLabel}
              onMode={(mode) => props.onMode?.(mode)}
            />
          ) : null}
          <KbdGroup
            className="ml-auto"
            aria-hidden
            title="Enter sends · Shift+Enter for a new line"
          >
            <Kbd>↵</Kbd>
          </KbdGroup>
          {running && !hasDraft ? (
            <InputGroupButton
              variant="outline"
              size="xs"
              onClick={props.onStop}
              aria-label="Stop the agent's turn"
            >
              <Square size={12} aria-hidden />
              Stop
            </InputGroupButton>
          ) : (
            <InputGroupButton variant="default" size="xs" onClick={send} disabled={!canSend}>
              <ArrowUp size={12} aria-hidden />
              {running ? (props.followUp === "steer" ? "Steer" : "Queue") : "Send"}
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

/** The session's permission mode, switched from the prompt box as in the agent's own. */
function ModeMenu({
  modes,
  mode,
  fallback,
  providerLabel,
  onMode,
}: {
  modes: { id: string; label: string; description?: string | undefined }[];
  mode: string | undefined;
  fallback: string | undefined;
  providerLabel: string;
  onMode(mode: string): void;
}) {
  const current = modes.find((m) => m.id === mode)?.label ?? mode ?? fallback ?? "Mode";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          size="xs"
          variant="ghost"
          className="min-w-0 gap-1 px-1.5 font-normal text-muted-foreground"
          aria-label={`Permission mode: ${current}. Change it`}
          data-agent-mode={mode}
        >
          <ShieldCheck size={12} aria-hidden />
          <span className="truncate">{current}</span>
          <ChevronDown size={12} className="opacity-60" aria-hidden />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          What {providerLabel} may do without asking
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode ?? ""} onValueChange={onMode}>
          {modes.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="items-start">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
