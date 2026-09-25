import { afterAll, beforeEach, expect, test } from "bun:test";
import type { AuthStatus } from "../api/auth.ts";
import { $, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * The account menu's "Report a bug or send feedback". What matters is the
 * consent and the gate: anonymous unless the user turns it off, and nothing
 * sent at all without an account — the dialog offers the sign-in instead.
 */

let auth: AuthStatus;
let feedbackResponse: () => Response;
const sent: unknown[] = [];

const signedIn: AuthStatus = {
  loggedIn: true,
  verified: true,
  login: { state: "idle" },
  account: { email: "dev@example.com", tier: "free" },
};
const signedOut: AuthStatus = { loggedIn: false, verified: null, login: { state: "idle" } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), "http://localhost");
  if (url.pathname === "/api/auth/status") return Response.json(auth);
  if (url.pathname === "/api/feedback" && init?.method === "POST") {
    sent.push(JSON.parse(String(init.body)));
    return feedbackResponse();
  }
  throw new Error(`unexpected fetch: ${url.pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { FeedbackDialog } = await import("../components/FeedbackDialog.tsx");
const { useCanvas } = await import("../store.ts");
const { setApiConnected } = await import("../api/connection.ts");
const { onSignInRequired } = await import("../api/sign-in-gate.ts");
// What App installs at mount: a sign-in the API layer discovers opens the dialog.
const stopSignInGate = onSignInRequired((prompt) => useCanvas.getState().openSignIn(prompt));
afterAll(stopSignInGate);

function typeBody(value: string): void {
  const textarea = $("[data-testid='feedback-dialog'] textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

const sendButton = () => $("[data-testid='feedback-send']") as HTMLButtonElement | null;

beforeEach(() => {
  sent.length = 0;
  auth = signedIn;
  feedbackResponse = () => Response.json({ message: "Thanks — your feedback was sent." });
  setApiConnected(true);
  useCanvas.setState({ authStatus: auth, feedbackOpen: true, signInPrompt: null });
});

domSuite("feedback dialog", () => {
  test("sends anonymously by default, with the kind the user picked", async () => {
    const view = await mount(<FeedbackDialog />);
    await settle();
    expect($("[data-testid='feedback-sign-in']")).toBeNull();
    expect($("[data-testid='feedback-anonymous']")?.getAttribute("aria-checked")).toBe("true");
    expect(text($("[data-testid='feedback-anonymous-help']"))).toContain("can't reply");
    expect(sendButton()?.disabled).toBe(true);

    await interact(() => typeBody("  The inspector jumps when I resize.  "));
    await interact(() => ($("[data-testid='feedback-kind-feedback']") as HTMLElement).click());
    await interact(() => sendButton()?.click());
    await settle();

    expect(sent).toEqual([
      { kind: "feedback", body: "The inspector jumps when I resize.", anonymous: true },
    ]);
    expect(useCanvas.getState().feedbackOpen).toBe(false);
    await view.unmount();
  });

  test("turning anonymity off sends from the account, and says so first", async () => {
    const view = await mount(<FeedbackDialog />);
    await settle();
    await interact(() => ($("[data-testid='feedback-anonymous']") as HTMLElement).click());
    expect(text($("[data-testid='feedback-anonymous-help']"))).toContain("dev@example.com");
    await interact(() => typeBody("Crash on export"));
    await interact(() => sendButton()?.click());
    await settle();
    expect(sent).toEqual([{ kind: "bug", body: "Crash on export", anonymous: false }]);
    await view.unmount();
  });

  test("signed out, it explains, offers the sign-in, and won't send", async () => {
    auth = signedOut;
    useCanvas.setState({ authStatus: signedOut });
    const view = await mount(<FeedbackDialog />);
    await settle();
    const gate = $("[data-testid='feedback-sign-in']");
    expect(gate).not.toBeNull();
    await interact(() => typeBody("Hello"));
    expect(sendButton()?.disabled).toBe(true);

    await interact(() => $("[data-testid='feedback-sign-in'] button")?.click());
    expect(useCanvas.getState().signInPrompt).toEqual({ action: "send your feedback" });
    expect(sent).toEqual([]);
    await view.unmount();
  });

  test("a session that ended mid-draft opens the sign-in and keeps the dialog", async () => {
    feedbackResponse = () =>
      Response.json({ error: { kind: "LoggedOut", message: "Not signed in." } }, { status: 401 });
    const view = await mount(<FeedbackDialog />);
    await settle();
    await interact(() => typeBody("Keep this"));
    await interact(() => sendButton()?.click());
    await settle();
    expect(useCanvas.getState().signInPrompt).not.toBeNull();
    expect(useCanvas.getState().feedbackOpen).toBe(true);
    expect(($("[data-testid='feedback-dialog'] textarea") as HTMLTextAreaElement).value).toBe(
      "Keep this",
    );
    await view.unmount();
  });
});
