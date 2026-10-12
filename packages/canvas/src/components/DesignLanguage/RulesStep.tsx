import { Check, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DesignRule, DesignRulesState } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.tsx";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "../ui/item.tsx";
import { Textarea } from "../ui/textarea.tsx";

const KINDS: ReadonlyArray<{ kind: DesignRule["kind"]; label: string; placeholder: string }> = [
  { kind: "do", label: "Do", placeholder: "One primary action per view" },
  { kind: "dont", label: "Don't", placeholder: "Shadows on flat surfaces" },
];

/**
 * The rules in words. Each one is saved as it is added or removed, to the
 * design's own `guidance.md` — the file the agent is pointed at before it
 * composes and a review quotes from. A design that follows the repo's
 * DESIGN.md shows that file's rules instead, read-only: it is not Velloo's to
 * rewrite.
 */
export function RulesStep({ state }: { state: DesignRulesState }) {
  const saveRules = useCanvas((s) => s.saveRules);
  const readOnly = state.source !== null && !state.source.writable;
  const [intent, setIntent] = useState(state.intent);

  useEffect(() => {
    setIntent(state.intent);
  }, [state.intent]);

  const save = (next: { intent?: string; rules?: DesignRule[] }) => {
    void saveRules({ intent: next.intent ?? state.intent, rules: next.rules ?? state.rules }).catch(
      (err) => toastError(err, "Could not save the rules"),
    );
  };

  return (
    <div className="flex flex-col gap-5 p-4">
      {readOnly && state.source ? (
        <Alert>
          <AlertTitle>Read from {state.source.path}</AlertTitle>
          <AlertDescription>
            This design follows the repo's own design system document, so its rules are edited in
            that file. Changes show up here as soon as it is saved.
          </AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <FieldLabel htmlFor="language-intent">Intent</FieldLabel>
        <Textarea
          id="language-intent"
          value={intent}
          readOnly={readOnly}
          rows={3}
          placeholder="What this design is going for, in a sentence or two."
          onChange={(e) => setIntent(e.target.value)}
          onBlur={() => {
            if (!readOnly && intent.trim() !== state.intent) save({ intent: intent.trim() });
          }}
        />
      </Field>

      {KINDS.map(({ kind, label, placeholder }) => (
        <RuleList
          key={kind}
          kind={kind}
          label={label}
          placeholder={placeholder}
          rules={state.rules}
          readOnly={readOnly}
          onChange={(rules) => save({ rules })}
        />
      ))}

      {readOnly ? null : (
        <p className="text-xs text-muted-foreground">
          Saved to guidance.md in this design. Your agent reads it before composing, and a review
          quotes each rule word for word.
        </p>
      )}
    </div>
  );
}

function RuleList({
  kind,
  label,
  placeholder,
  rules,
  readOnly,
  onChange,
}: {
  kind: DesignRule["kind"];
  label: string;
  placeholder: string;
  rules: DesignRule[];
  readOnly: boolean;
  onChange: (rules: DesignRule[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const mine = rules.filter((r) => r.kind === kind);
  const inputId = `language-rule-${kind}`;

  const add = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    onChange([...rules, { kind, text }]);
  };

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {mine.length > 0 ? (
        <ItemGroup className="gap-1.5">
          {mine.map((rule) => (
            <Item key={rule.text} variant="outline" size="xs">
              <ItemMedia>
                {kind === "do" ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <X className="size-3.5 text-destructive" />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="text-xs font-normal leading-snug">{rule.text}</ItemTitle>
              </ItemContent>
              {readOnly ? null : (
                <ItemActions>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove rule: ${rule.text}`}
                    onClick={() => onChange(rules.filter((r) => r !== rule))}
                  >
                    <Trash2 />
                  </Button>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
      ) : readOnly ? (
        <FieldDescription className="text-xs">None stated.</FieldDescription>
      ) : null}
      {readOnly ? null : (
        <InputGroup>
          <InputGroupInput
            id={inputId}
            value={draft}
            // The example only until there is a real rule to read instead.
            placeholder={mine.length === 0 ? `e.g. ${placeholder}` : "Add another"}
            className="text-xs"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={`Add a ${label} rule`}
              disabled={draft.trim() === ""}
              onClick={add}
            >
              <Plus />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      )}
    </Field>
  );
}
