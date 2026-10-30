import { afterAll, beforeEach, expect, test } from "bun:test";
import type { InitCreateBody, InitState } from "@velloo/protocol/init";
import { $, $$, domSuite, interact, mount, settle, text } from "./dom.ts";

/**
 * Init's Velloo Cloud step: offered after the agents, never required. What
 * matters is that it walks the device flow the canvas's account menu uses,
 * and that the feedback opt-in it asks once signed in reaches the design.
 */

type Login =
  | { state: "idle" }
  | { state: "pending"; userCode: string; verificationUrl: string; expiresAt: string };

let auth: {
  loggedIn: boolean;
  verified: boolean | null;
  login: Login;
  account?: { email: string };
};
let feedbackAnswered: boolean;
const created: InitCreateBody[] = [];

const STATE = (): InitState => ({
  launchRoot: "/work/app",
  appRoot: "/work/app",
  apps: [],
  app: {
    found: false,
    library: { id: "none", label: "No library" },
    libraryNote: "",
    routes: [],
  },
  libraries: [{ id: "none", label: "No library", hint: "" }],
  storage: { repository: "velloo", external: "~/.velloo/designs" },
  suggestedName: "app",
  goals: [{ value: "blank", label: "Start blank", hint: "" }],
  agents: [],
  feedbackAnswered,
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const { pathname } = new URL(String(input), "http://localhost");
  const post = init?.method === "POST";
  if (pathname === "/api/init/state") return Response.json(STATE());
  if (pathname === "/api/init/check") return Response.json({ folder: "velloo", local: false });
  if (pathname === "/api/init/auth") return Response.json(auth);
  if (pathname === "/api/init/auth/login" && post) {
    auth = {
      ...auth,
      login: {
        state: "pending",
        userCode: "WXYZ-1234",
        verificationUrl: "https://velloo.ai/device?user_code=WXYZ-1234",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    };
    return Response.json(auth);
  }
  if (pathname === "/api/init/auth/cancel" && post) {
    auth = { ...auth, login: { state: "idle" } };
    return Response.json(auth);
  }
  if (pathname === "/api/init/create" && post) {
    created.push(JSON.parse(String(init?.body)) as InitCreateBody);
    return Response.json({ name: "app", folder: "/work/app/velloo", setup: false });
  }
  if (pathname === "/api/init/agents") return Response.json({ providers: [] });
  throw new Error(`unexpected fetch: ${pathname}`);
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { InitWizard } = await import("../init/InitWizard.tsx");

const button = (label: string) =>
  $$("button").find((b) => text(b).trim().startsWith(label)) as HTMLButtonElement | undefined;
const click = (label: string) =>
  interact(() => {
    const target = button(label);
    if (!target) throw new Error(`no "${label}" button`);
    target.click();
  });
const account = () => text($("[data-testid='init-cloud-account']"));

async function toCloudStep() {
  const view = await mount(<InitWizard />);
  await settle(300);
  await click("Continue");
  await click("Continue");
  await click("Next");
  await settle(10);
  return view;
}

beforeEach(() => {
  auth = { loggedIn: false, verified: null, login: { state: "idle" } };
  feedbackAnswered = false;
  created.length = 0;
});

domSuite("init's Velloo Cloud step", () => {
  test("says what's free, and can be skipped", async () => {
    const view = await toCloudStep();
    expect(text($("h1"))).toBe("Share your designs with Velloo Cloud");
    expect(text(document.body)).toContain("3 live share links");
    expect(account()).toContain("Sign up free");

    await click("Skip and create design");
    await settle(10);
    expect(created).toHaveLength(1);
    expect(created[0]?.feedback).toBeUndefined();
    await view.unmount();
  });

  test("signs up through the device flow, then asks about feedback", async () => {
    const view = await toCloudStep();
    await click("Sign up free");
    expect(account()).toContain("WXYZ-1234");
    // Creating waits while the sign-in is open in the other tab.
    expect(button("Skip and create design")?.disabled).toBe(true);

    auth = {
      loggedIn: true,
      verified: true,
      login: { state: "idle" },
      account: { email: "ana@example.com" },
    };
    await settle(1700);
    expect(account()).toContain("Signed in as ana@example.com");

    await interact(() => ($("#init-feedback") as HTMLElement).click());
    await interact(() => ($("#init-feedback-contact") as HTMLElement).click());
    await click("Create design");
    await settle(10);
    expect(created[0]?.feedback).toEqual({ enabled: true, contactOk: true });
    await view.unmount();
  });

  test("a cancelled sign-in goes back to the offer", async () => {
    const view = await toCloudStep();
    await click("Sign in");
    await click("Cancel");
    expect(account()).toContain("Get a free account");
    await view.unmount();
  });

  test("doesn't ask about feedback again in a repository that answered", async () => {
    feedbackAnswered = true;
    auth = {
      loggedIn: true,
      verified: true,
      login: { state: "idle" },
      account: { email: "ana@example.com" },
    };
    const view = await toCloudStep();
    expect(account()).toContain("Signed in as ana@example.com");
    expect($("#init-feedback")).toBeNull();
    await click("Create design");
    await settle(10);
    expect(created[0]?.feedback).toBeUndefined();
    await view.unmount();
  });
});
