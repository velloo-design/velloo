import type { AgentModelOption } from "@velloo/protocol/agent";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "../ui/native-select.tsx";
import { Spinner } from "../ui/spinner.tsx";

/** What an agent said about its models when asked ahead of a start. */
export type ModelChoiceState =
  | { state: "loading" }
  | { state: "ready"; models: AgentModelOption[]; model: string | undefined };

/**
 * The model a new session starts on, before it has one: a quiet "Default
 * model" until asked, since reading the list means starting the agent.
 */
export function ModelChoice(props: {
  label: string;
  state: ModelChoiceState | undefined;
  onRead(): void;
  onPick(model: string | undefined): void;
}) {
  const { label, state } = props;
  if (state === undefined) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={props.onRead}
        data-model-choice
      >
        Default model
        <ChevronDown />
      </Button>
    );
  }
  if (state.state === "loading") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
        <Spinner className="size-3" /> Asking {label}…
      </span>
    );
  }
  if (state.models.length === 0) {
    return <span className="text-xs text-muted-foreground">Picks its own model</span>;
  }
  return (
    <NativeSelect
      size="sm"
      aria-label={`${label} model`}
      value={state.model ?? ""}
      onChange={(e) => props.onPick(e.target.value || undefined)}
    >
      {state.model ? null : <NativeSelectOption value="">Default</NativeSelectOption>}
      {state.models.map((m) => (
        <NativeSelectOption key={m.id} value={m.id}>
          {m.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
