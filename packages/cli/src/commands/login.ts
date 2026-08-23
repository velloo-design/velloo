import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential, normalizeCloudUrl, saveCredential } from "../cloud-credentials.ts";
import { type DeviceLoginResult, performDeviceLogin, verifyCredential } from "../cloud-login.ts";
import { fail } from "../fail.ts";

// Block on Enter so the user knows the browser is about to open (and can read
// the URL/code first). Non-interactive (piped) stdin just continues.
async function waitForEnter(message: string): Promise<void> {
  if (!process.stdin.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

export default defineCommand({
  meta: {
    name: "login",
    description: "Log in to velloo-cloud (opens the browser, saves a CLI token)",
  },
  args: {
    url: {
      type: "string",
      description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or the built-in default)",
    },
    force: {
      type: "boolean",
      description: "Re-authenticate even if already logged in",
      default: false,
    },
  },
  async run({ args }) {
    const cloudUrl = args.url ? normalizeCloudUrl(args.url) : defaultCloudUrl();

    // Sticky login: a valid token is already saved in ~/.velloo → nothing to do.
    if (!args.force) {
      const existing = await loadCredential(cloudUrl);
      const email = existing && (await verifyCredential(cloudUrl, existing.token));
      if (email) {
        console.log(`velloo login: already logged in to ${cloudUrl} as ${email}.`);
        console.log(
          "  Use `velloo login --force` to switch accounts, or `velloo logout` to sign out.",
        );
        return;
      }
    }

    let result: DeviceLoginResult;
    try {
      result = await performDeviceLogin(cloudUrl, async ({ verificationUrl, userCode }) => {
        console.log(
          `\nvelloo login will open your browser to approve this device (code ${userCode}).`,
        );
        await waitForEnter("Press Enter to open the browser… ");
        console.log(`Opening ${verificationUrl}`);
        console.log(`If the browser doesn't open, visit that URL and enter: ${userCode}`);
      });
    } catch (err) {
      fail("login", err instanceof Error ? err.message : String(err));
    }

    const path = await saveCredential(cloudUrl, result);
    console.log(`velloo login: logged in to ${cloudUrl} as ${result.email}`);
    console.log(`  credentials saved to ${path}`);
  },
});
