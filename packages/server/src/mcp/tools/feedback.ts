import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CloudAuth } from "../../cloud.ts";
import { sendFeedback } from "../../feedback.ts";
import { type FeedbackError, feedbackError } from "../../feedback-tokens.ts";
import type { MutationContext } from "../../mutations/index.ts";
import { errorResult, jsonResult } from "./result.ts";

/**
 * Soft cap on sends per server lifetime — a misbehaving agent shouldn't be
 * able to flood the endpoint. Resets on restart; the cloud rate-limits too.
 */
const MAX_SENDS_PER_SESSION = 20;

/**
 * The shared sender speaks to a person; an agent also needs telling what to do
 * next — relay a sign-in to the user, or drop it and keep working — so it
 * never loops retrying a send that can't land.
 */
function forAgent(error: FeedbackError): FeedbackError {
  if (error.reason === "signed-out") {
    return {
      ...error,
      message:
        "Not signed in to velloo-cloud, so feedback can't be sent. Tell the user they can run `velloo login` if they want to send it, then carry on — don't retry without that.",
    };
  }
  if (error.reason === "unreachable") {
    return { ...error, message: `${error.message} Carry on with the task.` };
  }
  return error;
}

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
 * Both live in `sendFeedback` (feedback.ts), which the canvas's own
 * feedback button shares.
 *
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
        "Send free-text feedback about **Velloo itself** — a confusing instruction, a missing capability, a tool that misbehaved. NOT for feedback about the user's design. Show the user the exact `body` and get their go-ahead first; never send unprompted, and never include their design content, code, or file paths. Sent anonymously unless they opted into contact — a blind-signed token replaces the account credential — but needs a signed-in session either way. On failure the error's `reason` says whether to ask the user to sign in, retry later, or just carry on.",
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

      const result = await sendFeedback(cloud, {
        body,
        source: "agent",
        anonymous: !ctx.folder.config.feedback?.contactOk,
        toolVersion: ctx.folder.config.toolVersion,
      });
      if (!result.ok) return errorResult(forAgent(result.error));
      sent += 1;
      return jsonResult({ message: result.value });
    },
  );
}
