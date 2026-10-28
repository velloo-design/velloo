import type { AgentAnswers, AgentApprovalRequest, AgentQuestion } from "@velloo/protocol/agent";
import { Check, MessageCircleQuestion } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { Kbd } from "../ui/kbd.tsx";

/** What the person has said to one question: the options picked, and their own words. */
interface Reply {
  picked: string[];
  own: string;
}

function answerOf(question: AgentQuestion, reply: Reply): string[] {
  const own = reply.own.trim();
  if (!question.multiSelect) return own ? [own] : reply.picked.slice(0, 1);
  return own ? [...reply.picked, own] : reply.picked;
}

/**
 * An agent's question, with the options it offers. Picking answers it the way
 * the agent's own prompt would: one option, several for a multi-select, or
 * the person's own words where the agent takes them. Enter sends once every
 * question has an answer; Esc skips them all.
 */
export function QuestionCard({
  request,
  providerLabel,
  onAnswer,
  onSkip,
}: {
  request: AgentApprovalRequest & { questions: AgentQuestion[] };
  providerLabel: string;
  onAnswer: (answers: AgentAnswers) => void;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [replies, setReplies] = useState<Record<string, Reply>>({});
  const titleId = `approval-${request.id}`;
  const reply = (q: AgentQuestion): Reply => replies[q.id] ?? { picked: [], own: "" };
  const set = (q: AgentQuestion, next: Partial<Reply>) =>
    setReplies((all) => ({ ...all, [q.id]: { ...reply(q), ...next } }));
  const complete = request.questions.every((q) => answerOf(q, reply(q)).length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !complete) return;
    setBusy(true);
    onAnswer(Object.fromEntries(request.questions.map((q) => [q.id, answerOf(q, reply(q))])));
  };
  const skip = () => {
    if (busy) return;
    setBusy(true);
    onSkip();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skip();
    }
  };

  return (
    <Card
      size="sm"
      role="group"
      aria-labelledby={titleId}
      // Shrinks into the space the pane leaves it; its questions scroll instead.
      className="min-h-0 shrink gap-3 bg-accent/60 ring-1 ring-primary dark:bg-accent"
      data-agent-approval="question"
    >
      <CardHeader className="flex items-center gap-2">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <MessageCircleQuestion size={14} aria-hidden />
        </div>
        <CardTitle id={titleId} className="text-sm">
          {providerLabel} is asking
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-col">
        <form className="flex min-h-0 flex-col gap-3" onSubmit={submit} onKeyDown={onKeyDown}>
          {/* A long list scrolls on its own, so Answer and Skip stay in view. */}
          <div className="-mx-1 flex max-h-[45vh] min-h-24 shrink flex-col gap-4 overflow-y-auto px-1 py-0.5">
            {request.questions.map((q) => (
              <QuestionField
                key={q.id}
                question={q}
                reply={reply(q)}
                disabled={busy}
                onChange={(next) => set(q, next)}
              />
            ))}
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-1.5">
            <Button
              type="submit"
              size="sm"
              className="justify-between"
              disabled={busy || !complete}
            >
              <span>Answer</span>
              <Kbd className="bg-primary-foreground/10 text-primary-foreground">↵</Kbd>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-between bg-background"
              disabled={busy}
              onClick={skip}
            >
              <span>Skip</span>
              <Kbd>Esc</Kbd>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function QuestionField({
  question,
  reply,
  disabled,
  onChange,
}: {
  question: AgentQuestion;
  reply: Reply;
  disabled: boolean;
  onChange: (next: Partial<Reply>) => void;
}) {
  const name = useId();
  const multi = question.multiSelect === true;
  const ownWords = reply.own.trim().length > 0;
  const toggle = (label: string) => {
    if (!multi) return onChange({ picked: [label], own: "" });
    onChange({
      picked: reply.picked.includes(label)
        ? reply.picked.filter((p) => p !== label)
        : [...reply.picked, label],
    });
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 flex flex-col gap-1">
        {question.header ? (
          <Badge variant="secondary" className="w-fit">
            {question.header}
          </Badge>
        ) : null}
        <span className="text-sm leading-snug font-medium">{question.question}</span>
        {multi ? <span className="text-xs text-muted-foreground">Pick any that apply.</span> : null}
      </legend>
      {question.options.map((option) => {
        // Words of the person's own replace a single pick, so the pick shows cleared.
        const checked = reply.picked.includes(option.label) && (multi || !ownWords);
        return (
          <label
            key={option.label}
            className={cn(
              // Relative, so the hidden input sits inside the option: focusing it
              // must not scroll some other part of the pane into view.
              "relative flex cursor-pointer items-start gap-2.5 rounded-md border bg-background px-2.5 py-2 transition-colors",
              "hover:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
              checked && "border-primary ring-1 ring-primary",
            )}
          >
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              checked={checked}
              onChange={() => toggle(option.label)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                multi ? "rounded-sm" : "rounded-full",
                checked && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {checked ? <Check className="size-3" /> : null}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-xs font-medium leading-snug">{option.label}</span>
              {option.description ? (
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
      {question.other || question.options.length === 0 ? (
        <Input
          type={question.secret ? "password" : "text"}
          aria-label={
            question.options.length ? `${question.question} — in your own words` : question.question
          }
          placeholder={question.options.length ? "Or answer in your own words…" : "Your answer…"}
          value={reply.own}
          onChange={(e) => onChange({ own: e.target.value })}
          className="h-8 bg-background text-xs"
          autoComplete="off"
        />
      ) : null}
    </fieldset>
  );
}
