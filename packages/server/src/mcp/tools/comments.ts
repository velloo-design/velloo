import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CloudAuth } from "../../cloud.ts";
import { pullComments } from "../../cloud-comments.ts";
import type { MutationContext } from "../../mutations/index.ts";

/**
 * `pull_comments` — on-demand share-link comment sync. The daemon
 * already pulls at boot and on a slow interval; this lets the agent refresh
 * right now ("check for new feedback") and see the summary. Pull-only: the
 * cloud never writes into the repo — conversion to annotations happens here.
 * Registered unconditionally: logged-out / unpublished / offline are safe
 * no-ops that report their status instead of failing.
 */
export function registerCommentTools(mcp: McpServer, ctx: MutationContext, cloud: CloudAuth): void {
  mcp.registerTool(
    "pull_comments",
    {
      description:
        "Fetch reviewer comments left on this folder's published share links (velloo-cloud) and land new unresolved ones as annotations — read them afterwards with list_annotations (pulled ones carry the commenter + link in the body). Resolution syncs both ways: a pulled annotation deleted locally resolves its cloud comment; a comment resolved in the cloud removes its local annotation. Returns {status, pulled, resolvedUp, resolvedDown, unresolvedTotal, links} — unresolvedTotal counts pulled comments still waiting as annotations; links maps each share-link slug to ok | revoked | unknown (revoked links no longer sync; mention that to the user). Requires `velloo login` and a prior `velloo publish`; logged-out or offline it is a safe no-op that reports why.",
      inputSchema: {},
    },
    async () => {
      const summary = await pullComments(ctx, cloud);
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    },
  );
}
