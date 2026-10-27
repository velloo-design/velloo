import { Cloud, Plus, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.tsx";
import { Button } from "../ui/button.tsx";

/** New cloud comments waiting to be handed to the agent — offered, never sent. */
export function ArrivalNotice({
  title,
  onAdd,
  onDismiss,
}: {
  title: string;
  onAdd(): void;
  onDismiss(): void;
}) {
  return (
    <Alert className="relative bg-background pr-9" data-agent-arrival>
      <Cloud size={16} aria-hidden />
      <AlertTitle className="text-xs font-medium">{title}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-1.5 text-[11px]">
        <span>From the shared link</span>
        <Button variant="outline" size="xs" className="bg-background" onClick={onAdd}>
          <Plus size={12} aria-hidden />
          Add to agent
        </Button>
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 text-muted-foreground"
        onClick={onDismiss}
        aria-label={`Dismiss: ${title}`}
      >
        <X size={12} aria-hidden />
      </Button>
    </Alert>
  );
}
