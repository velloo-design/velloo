import type { CommentThreadView } from "@velloo/schema";
import { GitBranch } from "lucide-react";
import { Checkbox } from "../ui/checkbox.tsx";
import { Label } from "../ui/label.tsx";

/** Open cloud threads on one of the boards' other links. */
export interface CommentsElsewhere {
  slug: string;
  /** The branch that link was last published from, when it was. */
  branch: string | null;
  threadIds: string[];
}

/**
 * Group the open cloud threads that live on links other than `destination`.
 * Only threads the account can act on: a move is a write the cloud checks.
 */
export function commentsElsewhere(
  threads: CommentThreadView[],
  destination: string | null,
): CommentsElsewhere[] {
  const bySlug = new Map<string, CommentsElsewhere>();
  for (const thread of threads) {
    if (thread.scope !== "shared" || thread.status !== "open" || thread.manage === false) continue;
    if (thread.origin.kind !== "published" || thread.origin.slug === destination) continue;
    const slug = thread.origin.slug;
    const group = bySlug.get(slug) ?? { slug, branch: thread.branch ?? null, threadIds: [] };
    group.threadIds.push(thread.id);
    bySlug.set(slug, group);
  }
  return [...bySlug.values()];
}

/**
 * A board republished to a new link starts its own conversation — a branch's
 * review is about that branch — so its comments elsewhere stay put unless
 * someone asks for them here. Moving takes them off the old link.
 */
export function MigrateComments({
  groups,
  chosen,
  onToggle,
}: {
  groups: CommentsElsewhere[];
  chosen: string[];
  onToggle(slug: string, on: boolean): void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="grid gap-2" data-publish-migrate>
      <Label>Comments on other links</Label>
      <div className="rounded-md border">
        {groups.map((group) => {
          const count = group.threadIds.length;
          return (
            <div
              key={group.slug}
              className="flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/50"
            >
              <Checkbox
                id={`publish-migrate-${group.slug}`}
                checked={chosen.includes(group.slug)}
                onCheckedChange={(v) => onToggle(group.slug, v === true)}
              />
              <Label
                htmlFor={`publish-migrate-${group.slug}`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 font-normal"
              >
                <span className="shrink-0">
                  Bring {count} open comment{count === 1 ? "" : "s"} from
                </span>
                {group.branch ? (
                  <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs">
                    <GitBranch size={12} className="shrink-0" />
                    <span className="truncate">{group.branch}</span>
                  </span>
                ) : (
                  <span className="truncate font-mono text-xs">/s/{group.slug}/</span>
                )}
              </Label>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        Each link keeps its own conversation. Comments brought here leave the other link.
      </p>
    </div>
  );
}
