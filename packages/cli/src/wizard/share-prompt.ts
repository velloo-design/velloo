import { confirm, log, note, select, spinner } from "@clack/prompts";
import { readRepoFeedback, topUpTokens } from "@velloo/server";
import pc from "picocolors";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential, saveCredential } from "../cloud-credentials.ts";
import { performDeviceLogin, verifyCredential } from "../cloud-login.ts";
import { isAborted } from "./prompt-kit.ts";

/**
 * Promote signing in ("Share for free"), then — only if the user signs in —
 * offer the opt-in feedback tool. Sign-in is global (`~/.velloo`), independent
 * of the folder being created. Returns `{ feedback }` to merge into the wizard
 * answers (feedback omitted unless enabled), or `null` if the user cancels.
 * A sign-in failure is soft: we note it and continue without feedback.
 */
export async function promptShareAndFeedback(appRoot: string): Promise<{
  feedback?: { enabled: boolean; contactOk: boolean } | undefined;
} | null> {
  const cloudUrl = defaultCloudUrl();
  let signedIn = false;

  // Feedback consent is a repo preference, answered once. A second design
  // folder in a repo that already answered inherits it silently — re-asking
  // the same person the same consent question is how a wizard wears out its
  // welcome.
  const answered = await readRepoFeedback(appRoot);
  if (answered) {
    log.info(
      `Feedback tool: ${answered.enabled ? "on" : "off"} ${pc.dim("(already set for this repo)")}`,
    );
    return {};
  }

  // Sticky login: if ~/.velloo already holds a valid credential, don't ask to
  // sign in again — note who we are and go straight to the feedback opt-in.
  const existing = await loadCredential(cloudUrl);
  const existingEmail = existing ? await verifyCredential(cloudUrl, existing.token) : null;
  if (existingEmail) {
    note(`Signed in as ${existingEmail}.`, "Velloo cloud");
    signedIn = true;
  }

  if (!signedIn) {
    const ok = await promptSignIn(cloudUrl);
    if (ok === null) return null; // cancelled the whole wizard
    signedIn = ok;
  }

  if (!signedIn) return {};

  const details = [
    "The `send_feedback` tool lets your agent send free-text product feedback",
    "about Velloo itself — a confusing tool, a missing capability, something",
    "that slowed it down. Never about your design or your project.",
    "",
    "How it behaves:",
    "  - The agent always shows you the exact message and asks before sending.",
    "  - It is instructed to never include your design content, code, or",
    "    file/repo paths — only a plain-prose description of the issue.",
    `  - "Yes": anonymous by construction — the message is sent with a`,
    "    blind-signed token (RFC 9474) instead of your account, so the server",
    "    can verify it came from a real signed-in user but cannot tell which",
    "    one. The whole flow lives in velloo's open-source CLI, so you don't",
    "    have to take the cloud's word for it.",
    `  - "Yes — contact OK": sent from your account so we can reply by email.`,
    `  - "No": the tool is never registered, so the agent can't send anything.`,
  ].join("\n");

  // clack's select has no key-hook for a "press ? for more" footer, so the
  // details live behind a re-asking option instead.
  let choice: "yes" | "yes-contact" | "no";
  for (;;) {
    const picked = await select<"yes" | "yes-contact" | "no" | "details">({
      message:
        "Enable the feedback tool? Your agent can send Velloo product feedback to improve it.",
      options: [
        {
          value: "yes",
          label: "Yes — anonymous feedback",
          hint: "agent always confirms with you before sending",
        },
        {
          value: "yes-contact",
          label: "Yes — and it's OK to contact me about it",
          hint: "we may follow up by email",
        },
        { value: "no", label: "No", hint: "the tool is disabled entirely" },
        {
          value: "details",
          label: "What exactly gets sent?",
          hint: "prints details, then re-asks",
        },
      ],
      initialValue: "yes",
    });
    if (isAborted(picked)) return null;
    if (picked !== "details") {
      choice = picked;
      break;
    }
    note(details, "The feedback tool");
  }
  if (choice === "no") return {};

  // Anonymous feedback spends blind-signed tokens; pre-fetch a batch NOW so
  // a later send doesn't time-correlate with its issuance. Best-effort — the
  // send path tops up on demand. The blind-RSA round trips take a moment, so
  // show a spinner rather than letting the wizard look frozen.
  if (choice === "yes") {
    const cred = await loadCredential(cloudUrl);
    if (cred) {
      const spin = spinner();
      spin.start("Stocking anonymous feedback tokens");
      await topUpTokens({ url: cloudUrl, token: cred.token }, 10)
        .then(() => spin.stop("Anonymous feedback tokens ready"))
        .catch(() => spin.stop("Feedback enabled — tokens will be fetched on first send"));
    }
  }
  return { feedback: { enabled: true, contactOk: choice === "yes-contact" } };
}

/**
 * The interactive sign-in step: confirm intent, then run the device flow.
 * Returns true on a completed sign-in, false if the user declines or skips
 * (soft), or null if they cancel the whole wizard.
 */
async function promptSignIn(cloudUrl: string): Promise<boolean | null> {
  const wantShare = await confirm({
    message: "Share your designs for free? Sign up to publish branded share links.",
    initialValue: true,
  });
  if (isAborted(wantShare)) return null;
  if (!wantShare) return false;

  const spin = spinner();
  let signedIn = false;

  const controller = new AbortController();
  const hadRaw = process.stdin.isRaw ?? false;
  if (process.stdin.isTTY && !hadRaw) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  const onKey = (buf: Buffer) => {
    if (buf[0] === 0x1b) controller.abort();
  };
  process.stdin.on("data", onKey);

  try {
    const cred = await performDeviceLogin(
      cloudUrl,
      ({ verificationUrl, userCode }) => {
        note(
          `Opening your browser to sign up (or sign in).\nIf it doesn't open, visit:\n${pc.cyan(verificationUrl)}\nand enter the code: ${pc.bold(userCode)}\n\n${pc.dim("Press Esc to skip and continue without signing in.")}`,
          "Sign up",
        );
        spin.start("Waiting for sign-in  (Esc to skip)");
      },
      controller.signal,
    );
    await saveCredential(cloudUrl, cred);
    spin.stop(`Signed in as ${cred.email}`);
    signedIn = true;
  } catch (err) {
    if (controller.signal.aborted) {
      spin.stop("Sign-in skipped — continuing without it.");
    } else {
      spin.stop("Sign-in failed");
      note(
        `Couldn't sign in (${err instanceof Error ? err.message : String(err)}).\nYou can run ${pc.cyan("velloo login")} anytime later.`,
        "Heads up",
      );
    }
  } finally {
    process.stdin.off("data", onKey);
    // A user who gives up tends to tap Esc more than once. Swallow any input
    // still buffered (or arriving in the next breath) so a stray Esc doesn't
    // leak into clack's next prompt — clack reads Esc as "cancel", which would
    // silently skip the agent-wiring (MCP setup) step.
    if (controller.signal.aborted && process.stdin.isTTY) {
      const drain = () => {};
      process.stdin.on("data", drain);
      await new Promise<void>((r) => setTimeout(r, 150));
      process.stdin.off("data", drain);
    }
    if (process.stdin.isTTY && !hadRaw) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
  return signedIn;
}
