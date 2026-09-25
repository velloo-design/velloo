import { requestJson } from "./http.ts";

export type FeedbackKind = "bug" | "feedback";

/**
 * Send the user's own bug report or feedback through the daemon. Resolves to
 * the cloud's thank-you line; a signed-out daemon rejects with `LoggedOut`,
 * which `toastError` answers with the sign-in dialog.
 */
export async function sendFeedback(input: {
  kind: FeedbackKind;
  body: string;
  anonymous: boolean;
}): Promise<string> {
  return (await requestJson<{ message: string }>("POST", "/api/feedback", input)).message;
}
