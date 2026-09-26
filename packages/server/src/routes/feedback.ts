import { Hono } from "hono";
import { z } from "zod";
import type { CloudAuth } from "../cloud.ts";
import { type SendFeedbackOptions, sendFeedback } from "../feedback.ts";
import type { FeedbackErrorReason } from "../feedback-tokens.ts";

const FeedbackBody = z.object({
  kind: z.enum(["bug", "feedback"]),
  body: z.string().trim().min(1).max(6000),
  anonymous: z.boolean(),
});

/**
 * Each failure as the `CloudError` kind the canvas already knows how to show.
 * `LoggedOut` is the one it acts on — `toastError` turns it into the sign-in
 * dialog instead of a sentence with no way forward.
 */
const FAILURE: Record<
  FeedbackErrorReason,
  { kind: "LoggedOut" | "Unreachable" | "HttpFailure"; status: 401 | 429 | 502 }
> = {
  "signed-out": { kind: "LoggedOut", status: 401 },
  "no-tokens": { kind: "HttpFailure", status: 429 },
  "session-limit": { kind: "HttpFailure", status: 429 },
  unreachable: { kind: "Unreachable", status: 502 },
  rejected: { kind: "HttpFailure", status: 502 },
};

/**
 * The canvas's "Send feedback" menu item. Deliberately not gated
 * on `config.feedback.enabled`: that flag is whether the *agent* may send
 * feedback on the user's behalf, and this is the user sending their own.
 * What it does need is a cloud and a signed-in session, which `sendFeedback`
 * checks.
 */
export function createFeedbackRouter(
  cloud: CloudAuth | undefined,
  toolVersion: () => string | undefined,
  options: SendFeedbackOptions = {},
): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    if (!cloud?.url) {
      return c.json(
        {
          error: {
            kind: "BadRequest",
            message: "This canvas isn't connected to a velloo cloud to send feedback to.",
          },
        },
        503,
      );
    }
    const parsed = FeedbackBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json(
        {
          error: {
            kind: "BadRequest",
            message:
              "Feedback needs a kind, a message of up to 6000 characters, and whether to send it anonymously.",
          },
        },
        400,
      );
    }
    const result = await sendFeedback(
      cloud,
      {
        body: parsed.data.body,
        kind: parsed.data.kind,
        anonymous: parsed.data.anonymous,
        source: "canvas",
        toolVersion: toolVersion(),
      },
      options,
    );
    if (!result.ok) {
      const failure = FAILURE[result.error.reason];
      // The token layer's wording is written for a log; this one is read by
      // the person who can do something about it.
      const message =
        result.error.reason === "no-tokens"
          ? "You've used up this month's anonymous feedback. Turn off “Send anonymously” to send it from your account."
          : result.error.message;
      return c.json({ error: { kind: failure.kind, message } }, failure.status);
    }
    return c.json({ message: result.value });
  });

  return app;
}
