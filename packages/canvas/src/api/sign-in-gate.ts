/**
 * Where "you need to sign in" goes when it is discovered deep in the API layer.
 *
 * A module-level handler rather than a store call, for the same reason
 * `connection.ts` is one: the store imports the API layer, so the API layer
 * importing the store would cycle. The chrome registers the real handler once
 * at mount; before that (and in tests) a sign-in prompt is simply dropped,
 * which is correct — there is no dialog to open yet.
 */

/** What the user was trying to do, as a verb phrase: "publish this board". */
export interface SignInPrompt {
  action?: string | undefined;
  /** A credential existed and the cloud rejected it, rather than none at all. */
  expired?: boolean | undefined;
}

let handler: ((prompt: SignInPrompt) => void) | null = null;

/** Install the chrome's handler. Returns a teardown for the unmount path. */
export function onSignInRequired(next: (prompt: SignInPrompt) => void): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Ask the chrome for a sign-in. A no-op when nothing is mounted to answer. */
export function askToSignIn(prompt: SignInPrompt = {}): void {
  handler?.(prompt);
}
