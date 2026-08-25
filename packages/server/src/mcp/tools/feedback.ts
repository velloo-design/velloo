import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { sendAnonymousFeedback } from "../../feedback-tokens.ts";
import type { MutationContext } from "../../mutations/index.ts";

type McpResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

function jsonResult(value: unknown): McpResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/**
 * Soft cap on sends per server lifetime — a misbehaving agent shouldn't be
 * able to flood the endpoint. Resets on restart; the cloud rate-limits too.
 */
const MAX_SENDS_PER_SESSION = 20;

/**
 * `send_feedback` — the single deliberate, opt-in outbound call in
 * `@velloo/server` (the package is otherwise fully offline — see commits
 * b4066ab/b06da73). Registered only when `config.feedback.enabled` is true.
 * The same server↔cloud shape will carry `pull_comments` (cloud.md §2).
 *
 * Two paths by consent: `contactOk: true` posts over the authenticated
 * channel (identity is the point — the user asked to be reachable);
 * otherwise the message spends a blind-signed token on the unauthenticated
 * endpoint (see feedback-tokens.ts) so it cannot be linked to the account.
 *
 * The payload is free text plus non-identifying metadata: no design content,
 * no code, no file/repo paths. The instructions tell the agent to confirm with
 * the user and keep it that way; this handler never reads the design tree.
 */
export function registerFeedbackTool(mcp: McpServer, ctx: MutationContext, cloud: CloudAuth): void {
  let sent = 0;
  mcp.registerTool(
    "send_feedback",
    {
      description:
        "Send free-text product feedback about Velloo itself — the tool, its MCP surface, a confusing instruction, a missing capability, a tool that misbehaved, or anything that slowed you down. This is NOT for feedback about the user's design. ALWAYS show the user the exact `body` and get their confirmation before calling; never send unprompted. NEVER include the user's design content, code, or file/repo paths — describe the issue in your own words. Unless the user opted into being contacted, the message is sent ANONYMOUSLY: a blind-signed token (RFC 9474) replaces the account credential, so the server can verify it came from a real velloo user but cannot tell which one. If you hit real friction during a session (a tool that fought you, a missing capability), it's worth offering ONCE at a natural stopping point — after finishing the task — to send a short note; drop it if the user declines.",
      inputSchema: {
        body: z
          .string()
          .min(1)
          .max(6000)
          .describe("The feedback in plain prose. No design content, code, or file/repo paths."),
      },
    },
    async ({ body }) => {
      if (sent >= MAX_SENDS_PER_SESSION) {
        return jsonResult({
          ok: false,
          message: `Feedback limit reached for this session (${MAX_SENDS_PER_SESSION}). Restart the server to send more.`,
        });
      }

      // Without contact consent, feedback goes over the anonymous path: a
      // blind-signed token (RFC 9474) instead of the account credential, so
      // the cloud can verify "a real velloo user" but not which one. See
      // feedback-tokens.ts for the full trust story.
      if (!ctx.folder.config.feedback?.contactOk) {
        const result = await sendAnonymousFeedback(cloud, {
          body,
          toolVersion: ctx.folder.config.toolVersion,
          source: "agent",
        });
        if (result.ok) sent += 1;
        return jsonResult(result);
      }

      if (!cloud.token) {
        return jsonResult({
          ok: false,
          message: "Not signed in to velloo-cloud — run `velloo login`, then restart the server.",
        });
      }
      try {
        const res = await fetch(`${cloud.url}/v1/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cloud.token}`,
          },
          body: JSON.stringify({
            body,
            source: "agent",
            toolVersion: ctx.folder.config.toolVersion,
            contactOk: ctx.folder.config.feedback?.contactOk ?? false,
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          return jsonResult({ ok: false, message: `Feedback not sent (${res.status}).` });
        }
        sent += 1;
        return jsonResult({ ok: true, message: "Thanks — your feedback was sent." });
      } catch {
        // Offline-tolerant: a cloud outage must never break the agent's work.
        return jsonResult({
          ok: false,
          message: "Couldn't reach velloo-cloud; feedback not sent.",
        });
      }
    },
  );
}
