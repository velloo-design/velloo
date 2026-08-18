import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { normalizeCloudUrl, saveCredential } from "../cloud-credentials.ts";
import { fail } from "../fail.ts";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {
    // printing the URL is the fallback
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  },
  async run({ args }) {
    const cloudUrl = args.url ? normalizeCloudUrl(args.url) : defaultCloudUrl();

    const configRes = await fetch(`${cloudUrl}/v1/auth/config`).catch(() => null);
    if (!configRes?.ok) {
      fail("login", `cannot reach ${cloudUrl} — is velloo-cloud up?`);
    }
    const { issuer, clientId } = (await configRes.json()) as { issuer: string; clientId: string };

    const codeRes = await fetch(`${issuer}/api/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    }).catch(() => null);
    if (!codeRes?.ok) {
      fail("login", `the auth service at ${issuer} is not answering — is it up?`);
    }
    const device = (await codeRes.json()) as DeviceCodeResponse;

    console.log(`Opening ${device.verification_uri_complete}`);
    console.log(`If the browser doesn't open, visit that URL and enter: ${device.user_code}`);
    openBrowser(device.verification_uri_complete);

    const deadline = Date.now() + device.expires_in * 1000;
    let intervalMs = Math.max(1, device.interval) * 1000;
    let accessToken: string | null = null;
    while (Date.now() < deadline) {
      await sleep(intervalMs);
      const res = await fetch(`${issuer}/api/auth/device/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.device_code,
          client_id: clientId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (body.access_token) {
        accessToken = body.access_token;
        break;
      }
      if (body.error === "authorization_pending") continue;
      if (body.error === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      fail("login", body.error_description ?? body.error ?? "device authorization failed");
    }
    if (!accessToken) fail("login", "the sign-in code expired — run velloo login again");

    const exchangeRes = await fetch(`${cloudUrl}/v1/auth/cli-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    if (exchangeRes.status !== 201) {
      const body = (await exchangeRes.json().catch(() => ({}))) as { message?: string };
      fail("login", `token exchange failed (${exchangeRes.status}): ${body.message ?? "unknown"}`);
    }
    const { token, email } = (await exchangeRes.json()) as { token: string; email: string };

    const path = await saveCredential(cloudUrl, { token, email });
    console.log(`velloo login: logged in to ${cloudUrl} as ${email}`);
    console.log(`  credentials saved to ${path}`);
  },
});
