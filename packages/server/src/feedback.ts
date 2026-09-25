import { err, ok, type Result } from "@velloo/result";
import { type CloudAuth, currentToken } from "./cloud.ts";
import { type FeedbackError, feedbackError, sendAnonymousFeedback } from "./feedback-tokens.ts";

type FeedbackKind = "bug" | "feedback";

/** Who is sending: the agent's `send_feedback` tool or the canvas's own button. */
type FeedbackSource = "agent" | "canvas";

export interface FeedbackSubmission {
  body: string;
  source: FeedbackSource;
  /** Only the canvas asks; the agent tool has no way to tell the two apart. */
  kind?: FeedbackKind | undefined;
  /** Without contact consent the message spends a blind token instead of the account credential. */
  anonymous: boolean;
  toolVersion?: string | undefined;
}

export interface SendFeedbackOptions {
  /** Where anonymous tokens are kept; tests point it at a tmp file. */
  tokenStorePath?: string | undefined;
}

/**
 * Deliver one feedback message to velloo-cloud. Shared by the agent tool and
 * the canvas route so both honour the same consent rule: anonymous unless the
 * sender opted into contact.
 *
 * Both paths need a signed-in session — the anonymous one mints its token over
 * the authenticated channel — so being logged out is checked once, up front.
 * The token is resolved live rather than read off `cloud.token`, which is the
 * boot-time credential: a canvas that signed in after the daemon started
 * would otherwise be told it is signed out.
 *
 * The payload is the free text plus non-identifying metadata; nothing here
 * reads the design folder. Never throws.
 */
export async function sendFeedback(
  cloud: CloudAuth,
  submission: FeedbackSubmission,
  options: SendFeedbackOptions = {},
): Promise<Result<string, FeedbackError>> {
  const token = await currentToken(cloud);
  if (!token) {
    return err(
      feedbackError(
        "signed-out",
        "Not signed in to velloo-cloud, so feedback can't be sent.",
        false,
      ),
    );
  }
  const signedIn: CloudAuth = { ...cloud, token };

  if (submission.anonymous) {
    return sendAnonymousFeedback(
      signedIn,
      {
        body: submission.body,
        toolVersion: submission.toolVersion,
        source: submission.source,
        kind: submission.kind,
      },
      options.tokenStorePath,
    );
  }

  try {
    const res = await fetch(`${cloud.url}/v1/feedback`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        body: submission.body,
        source: submission.source,
        ...(submission.kind ? { kind: submission.kind } : {}),
        toolVersion: submission.toolVersion,
        contactOk: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return err(
        feedbackError("rejected", `velloo-cloud refused the message (${res.status}).`, false),
      );
    }
    return ok("Thanks — your feedback was sent.");
  } catch {
    return err(
      feedbackError("unreachable", "Couldn't reach velloo-cloud; feedback not sent.", true),
    );
  }
}
