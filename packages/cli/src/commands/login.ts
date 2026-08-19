import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { normalizeCloudUrl, saveCredential } from "../cloud-credentials.ts";
import { type DeviceLoginResult, performDeviceLogin } from "../cloud-login.ts";
import { fail } from "../fail.ts";

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

    let result: DeviceLoginResult;
    try {
      result = await performDeviceLogin(cloudUrl, ({ verificationUrl, userCode }) => {
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
