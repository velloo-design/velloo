import type { AgentModelOption } from "@velloo/protocol/agent";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.tsx";
import { ProviderLogo } from "./provider-logo.tsx";

/**
 * The model the session runs on, beside the agent's logo in the session
 * header, and the others it can switch to. The choice applies from the next
 * message, as the agent's own `/model`.
 */
export function ModelMenu({
  provider,
  providerLabel,
  label,
  model,
  models,
  onModel,
}: {
  provider: string;
  providerLabel: string;
  label: string;
  model: string | undefined;
  models: AgentModelOption[];
  onModel(model: string): void;
}) {
  const trigger = (
    <Button
      variant="outline"
      size="xs"
      className="min-w-0 gap-1 px-1.5 font-medium disabled:opacity-100"
      aria-label={
        models.length > 0
          ? `${providerLabel} model: ${label}. Change it`
          : `${providerLabel} model: ${label}`
      }
      title={`${providerLabel} · ${label}`}
      disabled={models.length === 0}
      data-agent-model={model ?? label}
    >
      <ProviderLogo provider={provider} size={12} />
      <span className="truncate">{label}</span>
      {models.length > 0 ? (
        <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden />
      ) : null}
    </Button>
  );
  if (models.length === 0) return trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
          {providerLabel} uses it from your next message
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={model ?? ""} onValueChange={onModel}>
          {models.map((option) => (
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
