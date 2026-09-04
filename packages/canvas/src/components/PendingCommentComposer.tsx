import { MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CommentScope } from "../api.ts";
import { useCanvas } from "../store.ts";
import { CommentTargetPicker } from "./CommentScopeControls.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";

export function PendingCommentComposer() {
  const anchor = useCanvas((state) => state.pendingCommentAnchor);
  const board = useCanvas((state) =>
    state.currentBoardId ? state.boards[state.currentBoardId] : undefined,
  );
  const nodeRects = useCanvas((state) => state.nodeRects);
  const frameInsets = useCanvas((state) => state.frameInsets);
  const cloud = useCanvas((state) => state.cloudComments);
  const clear = useCanvas((state) => state.clearPendingComment);
  const create = useCanvas((state) => state.createPendingComment);
  const publishBoardNow = useCanvas((state) => state.publishBoardNow);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<CommentScope>("local");

  // biome-ignore lint/correctness/useExhaustiveDependencies: a different picked anchor starts a fresh draft
  useEffect(() => setDraft(""), [anchor]);
  if (!anchor || !board) return null;

  let x: number;
  let y: number;
  if (anchor.kind === "board") {
    x = anchor.x + 14;
    y = anchor.y + 14;
  } else {
    const frame = board.frames.find((candidate) => candidate.id === anchor.frameId);
    if (!frame) return null;
    const inset = frameInsets[frame.id] ?? { x: 0, y: 0, chromeH: 0 };
    const selection = useCanvas.getState().selection;
    const rect =
      selection?.screenId === anchor.screenId ? nodeRects[frame.id]?.[selection.path] : undefined;
    const target = rect ?? anchor.bounds;
    x = frame.x + inset.x + target.x + target.w + 14;
    y = frame.y + inset.y + target.y;
  }

  const submit = () => {
    if (!draft.trim()) return;
    void create(draft, scope).then(() => setDraft(""));
  };

  return (
    <div
      className="absolute z-30 w-72 rounded-lg border bg-card p-3 shadow-xl"
      style={{ left: x, top: y }}
      data-inline-comment-composer
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <MapPin size={13} />
        {anchor.kind === "node" ? "Pinned comment" : "Pinned board location"}
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground"
          aria-label="Cancel comment"
          onClick={clear}
        >
          <X size={13} />
        </button>
      </div>
      <Textarea
        autoFocus
        aria-label="New pinned comment"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="What should change?"
        className="min-h-20 resize-none text-sm"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            clear();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <CommentTargetPicker
          scope={scope}
          onChange={setScope}
          cloud={cloud}
          onPublish={() => publishBoardNow({ id: board.id, name: board.name }, "public")}
        />
        <Button size="sm" className="ml-auto" disabled={!draft.trim()} onClick={submit}>
          Add comment
        </Button>
      </div>
    </div>
  );
}
