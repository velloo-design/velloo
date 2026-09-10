import { Cloud, MessageCircle, TriangleAlert } from "lucide-react";
import {
  type CloudCommentAvailability,
  type CommentScope,
  type CommentScopeFilter,
  cloudUnavailableHint,
  signInClears,
} from "../api.ts";
import { useCanvas } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

export const LOCAL_COMMENT_SCOPE_HELP =
  "Local comments stay on this machine. Cloud comments live on the published board, where reviewers can see and answer them.";

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
 * Where the thread being written will live — the choice the composer is really
 * asking about, so it gets the full width of the row rather than a pair of
 * chips beside the submit button.
 *
 * An unpublished board is *not* treated as a blocker here. It is the one
 * blocker the act of posting can clear on its own, so Cloud stays pickable and
 * carries a marker instead, and submitting walks through the publish dialog.
 * The blockers posting can't clear (signed out, no account at all) still
 * disable it, and a sign-in is offered where it would help.
 */
export function CommentTargetToggle({
  scope,
  onChange,
  cloud,
  className = "",
}: {
  scope: CommentScope;
  onChange(scope: CommentScope): void;
  cloud: CloudCommentAvailability | undefined;
  className?: string | undefined;
}) {
  const openSignIn = useCanvas((s) => s.openSignIn);
  const pending = cloud === undefined;
  const blocked = cloud?.available === false ? cloud.reason : null;
  const needsPublish = blocked === "unpublished";
  const closed = Boolean(blocked) && !needsPublish;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} data-comment-target-picker>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        // Joined and split evenly: two halves of one control read as a choice
        // between them, where two loose chips read as two switches.
        spacing={0}
        value={scope}
        onValueChange={(value) => value && onChange(value as CommentScope)}
        className="w-full"
        aria-label="Comment target"
      >
        <ToggleGroupItem value="local" className="flex-1 text-xs" title={LOCAL_COMMENT_SCOPE_HELP}>
          <MessageCircle /> Local
        </ToggleGroupItem>
        <ToggleGroupItem
          value="shared"
          className="flex-1 text-xs"
          disabled={pending || closed}
          title={
            blocked && !needsPublish
              ? cloudUnavailableHint(blocked)
              : needsPublish
                ? "This board has no published link yet — posting will publish it first."
                : cloud?.available
                  ? `Post to the published board at ${cloud.url}`
                  : "Checking this board's published link…"
          }
        >
          <Cloud /> Cloud
          {needsPublish ? (
            <TriangleAlert className="text-amber-600 dark:text-amber-500" data-needs-publish />
          ) : null}
        </ToggleGroupItem>
      </ToggleGroup>
      {scope === "shared" && needsPublish ? (
        <p className="text-[11px] text-muted-foreground">
          This board isn't published yet. Posting opens the publish flow first.
        </p>
      ) : null}
      {/* The blocker posting can't clear on its own still gets the control
          that clears it — a disabled toggle with an explanation is only half
          an answer. */}
      {blocked && signInClears(blocked) ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-[11px]"
          onClick={() =>
            openSignIn({
              action: "post comments to the published board",
              expired: blocked === "expired",
            })
          }
        >
          Sign in to write cloud comments
        </Button>
      ) : null}
    </div>
  );
}
