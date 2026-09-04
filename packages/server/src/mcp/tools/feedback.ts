import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CloudAuth, currentToken } from "../../cloud.ts";
import { feedbackError, sendAnonymousFeedback } from "../../feedback-tokens.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult } from "./result.ts";

/**
 * Soft cap on sends per server lifetime — a misbehaving agent shouldn't be
 * able to flood the endpoint. Resets on restart; the cloud rate-limits too.
 */
const MAX_SENDS_PER_SESSION = 20;

/**
 * `send_feedback` — the single deliberate, opt-in outbound call in
 * `@velloo/server` (the package is otherwise fully offline — see commits
 * b4066ab/b06da73). Registered only when `config.feedback.enabled` is true AND
 * a cloud URL is configured: with no cloud there is nothing the tool could
 * ever do, so it costs the session nothing instead of advertising a dead verb.
 *
 * Two paths by consent: `contactOk: true` posts over the authenticated
 * channel (identity is the point — the user asked to be reachable);
 * otherwise the message spends a blind-signed token on the unauthenticated
 * endpoint (see feedback-tokens.ts) so it cannot be linked to the account.
 *
 * Both paths need a signed-in session — the anonymous one mints its token over
 * the authenticated channel — so being logged out is checked once, up front.
 * Every way this can fail returns `isError` with a `kind` and a `reason` the
 * agent can branch on. It used to answer with `{ ok: false, message }` through
 * `jsonResult`: a failure delivered as an ordinary result, which an agent has
 * no reliable way to notice.
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
        "Send free-text product feedback about Velloo itself — the tool, its MCP surface, a confusing instruction, a missing capability, a tool that misbehaved, or anything that slowed you down. This is NOT for feedback about the user's design. ALWAYS show the user the exact `body` and get their confirmation before calling; never send unprompted. NEVER include the user's design content, code, or file/repo paths — describe the issue in your own words. Unless the user opted into being contacted, the message is sent ANONYMOUSLY: a blind-signed token (RFC 9474) replaces the account credential, so the server can verify it came from a real velloo user but cannot tell which one. Needs a signed-in session either way. If you hit real friction during a session (a tool that fought you, a missing capability), it's worth offering ONCE at a natural stopping point — after finishing the task — to send a short note; drop it if the user declines. On failure the error's `reason` says whether to tell the user to sign in, retry later, or just carry on.",
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
        return errorResult(
          feedbackError(
            "session-limit",
            `Feedback limit reached for this session (${MAX_SENDS_PER_SESSION}). Don't retry; carry on with the task.`,
            false,
          ),
        );
      }

      // Both paths need the account: the authenticated one sends as the user,
      // the anonymous one mints its blind token over the same channel. Checking
      // once here means a logged-out agent gets one actionable answer instead
      // of a token-issuance failure it has to interpret.
      const token = await currentToken(cloud);
      if (!token) {
        return errorResult(
          feedbackError(
            "signed-out",
            "Not signed in to velloo-cloud, so feedback can't be sent. Tell the user they can run `velloo login` if they want to send it, then carry on — don't retry without that.",
            false,
          ),
        );
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
        if (!result.ok) return errorResult(result.error);
        sent += 1;
        return jsonResult({ message: result.value });
      }

      try {
        const res = await fetch(`${cloud.url}/v1/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
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
          return errorResult(
            feedbackError("rejected", `velloo-cloud refused the message (${res.status}).`, false),
          );
        }
        sent += 1;
        return jsonResult({ message: "Thanks — your feedback was sent." });
      } catch {
        // A cloud outage must never break the agent's work — but it is still a
        // failure, and saying so is what lets the agent drop it and move on
        // rather than believe the message landed.
        return errorResult(
          feedbackError(
            "unreachable",
            "Couldn't reach velloo-cloud; feedback not sent. Carry on with the task.",
            true,
          ),
        );
      }
    },
  );
}
