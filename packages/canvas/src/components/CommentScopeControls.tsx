import { Cloud, MessageCircle } from "lucide-react";
import type { CloudCommentAvailability, CommentScope, CommentScopeFilter } from "../api.ts";
import { Button } from "./ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

export const LOCAL_COMMENT_SCOPE_HELP =
  "Local comments stay on this machine. Cloud comments live on the published board, where reviewers can see and answer them.";

/** Why the cloud target is closed, in the words the composer shows. */
export function cloudUnavailableHint(
  reason: Extract<CloudCommentAvailability, { available: false }>["reason"],
): string {
  switch (reason) {
    case "signed-out":
      return "Sign in to velloo cloud to write a cloud comment.";
    case "unpublished":
      return "Publish this board to write a cloud comment on it.";
    default:
      return "This canvas cannot write cloud comments.";
  }
}

export function CommentScopeFilterToggle({
  scope,
  onChange,
}: {
  scope: CommentScopeFilter;
  onChange(scope: CommentScopeFilter): void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={scope}
      // Radix clears the value when the active item is pressed again; a filter
      // with nothing selected has no meaning, so ignore the empty case.
      onValueChange={(value) => value && onChange(value as CommentScopeFilter)}
      className="w-full"
      aria-label="Comment scope"
    >
      <ToggleGroupItem value="all" className="text-[11px]">
        All
      </ToggleGroupItem>
      <ToggleGroupItem value="local" className="text-[11px]">
        <MessageCircle /> Local
      </ToggleGroupItem>
      <ToggleGroupItem value="shared" className="text-[11px]">
        <Cloud /> Cloud
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/**
 * Where a thread being written will live. The cloud side is only offered when
 * the daemon can actually reach a published link for this board — an honest
 * disabled control with the reason beats a choice that fails on submit.
 */
export function CommentTargetPicker({
  scope,
  onChange,
  cloud,
  onPublish,
}: {
  scope: CommentScope;
  onChange(scope: CommentScope): void;
  cloud: CloudCommentAvailability | undefined;
  onPublish?: (() => void) | undefined;
}) {
  const pending = cloud === undefined;
  const blocked = cloud?.available === false ? cloud.reason : null;
  const hint = blocked ? cloudUnavailableHint(blocked) : null;
  return (
    <div className="flex items-center gap-1.5" data-comment-target-picker>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={scope}
        onValueChange={(value) => value && onChange(value as CommentScope)}
        aria-label="Comment target"
      >
        <ToggleGroupItem value="local" className="text-[11px]" title={LOCAL_COMMENT_SCOPE_HELP}>
          <MessageCircle /> Local
        </ToggleGroupItem>
        <ToggleGroupItem
          value="shared"
          className="text-[11px]"
          disabled={pending || Boolean(blocked)}
          title={
            hint ??
            (cloud?.available
              ? `Post to the published board at ${cloud.url}`
              : "Checking this board's published link…")
          }
        >
          <Cloud /> Cloud
        </ToggleGroupItem>
      </ToggleGroup>
      {blocked === "unpublished" && onPublish ? (
        <Button variant="ghost" size="sm" className="text-[11px]" onClick={onPublish}>
          Publish
        </Button>
      ) : null}
    </div>
  );
}
