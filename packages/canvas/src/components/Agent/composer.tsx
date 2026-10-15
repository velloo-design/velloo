import type { AgentContextCard } from "@velloo/protocol/agent";
import { ArrowUp, AtSign, Clock, Square, X } from "lucide-react";
import { useId } from "react";
import { submitOnModEnter } from "../../keys.ts";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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

/** The most specific suggestions show as chips; the rest wait in the @ menu. */
const SUGGESTED_CHIPS = 2;

export interface ComposerProps {
  text: string;
  cards: AgentContextCard[];
  /** What the canvas offers to attach, from where the person is now. */
  suggestions: AgentContextCard[];
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
}

/**
 * The prompt box: context cards above it, comments as cards of their own, and
 * a send that becomes Stop while the agent works and nothing new is typed.
 * Cards alone are a complete message — the agent addresses the comments.
 */
export function AgentComposer(props: ComposerProps) {
  const { cards, suggestions, running, providerLabel } = props;
  const inputId = useId();
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
      : `Ask ${providerLabel}…`;
  const send = () => {
    if (canSend) props.onSend();
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
      {chips.length > 0 || suggestions.length > 0 || props.view ? (
        <fieldset className="flex flex-wrap items-center gap-1.5" aria-label="Context">
          {props.view ? (
            props.viewIncluded ? (
              <ContextChip
                card={{ ...props.view, label: `Viewing ${props.view.label.split(" › ").pop()}` }}
                variant="attached"
                onRemove={() => props.onViewIncluded?.(false)}
              />
            ) : (
              <ContextChip
                card={{ ...props.view, label: `Viewing ${props.view.label.split(" › ").pop()}` }}
                variant="suggested"
                onAdd={() => props.onViewIncluded?.(true)}
              />
            )
          ) : null}
          {suggestions.slice(0, SUGGESTED_CHIPS).map((card) => (
            <ContextChip
              key={`s:${card.kind}:${card.label}`}
              card={card}
              variant="suggested"
              onAdd={() => props.onAttach(card)}
            />
          ))}
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
          onKeyDown={submitOnModEnter(send)}
        />
        <InputGroupAddon className="gap-1" align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <InputGroupButton size="icon-xs" variant="ghost" aria-label="Attach canvas context">
                <AtSign size={14} aria-hidden />
              </InputGroupButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
                Attach from the canvas
              </DropdownMenuLabel>
              {suggestions.length === 0 ? (
                <DropdownMenuItem disabled>Select a board, frame or node first</DropdownMenuItem>
              ) : (
                suggestions.map((card) => (
                  <DropdownMenuItem
                    key={`m:${card.kind}:${card.label}`}
                    onSelect={() => props.onAttach(card)}
                  >
                    <span className="truncate">
                      {card.kind === "preview" ? "Preview of " : ""}
                      {card.label}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <KbdGroup className="ml-auto" aria-hidden>
            <Kbd>⌘</Kbd>
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
