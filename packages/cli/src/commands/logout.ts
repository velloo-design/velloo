import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import {
  clearCredentials,
  deleteCredential,
  listCredentials,
  loadCredential,
  normalizeCloudUrl,
} from "../cloud-credentials.ts";
import { revokeCredential } from "../cloud-login.ts";

export default defineCommand({
  meta: {
    name: "logout",
    description: "Log out of velloo-cloud (signs the CLI token out and removes it)",
  },
  args: {
    url: {
      type: "string",
      description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or the built-in default)",
    },
    all: {
      type: "boolean",
      default: false,
      description: "Remove saved credentials for every cloud",
    },
  },
  async run({ args }) {
    if (args.all) {
      await Promise.all(
        Object.entries(await listCredentials()).map(([cloudUrl, credential]) =>
          revokeCredential(cloudUrl, credential.token),
        ),
      );
      const count = await clearCredentials();
      console.log(
        count > 0
          ? `velloo logout: removed credentials for ${count} cloud${count === 1 ? "" : "s"}`
          : "velloo logout: no saved credentials",
      );
      return;
    }

    const cloudUrl = args.url ? normalizeCloudUrl(args.url) : defaultCloudUrl();
    const existing = await loadCredential(cloudUrl);
    if (existing) await revokeCredential(cloudUrl, existing.token);
    if (await deleteCredential(cloudUrl)) {
      console.log(
        `velloo logout: logged out of ${cloudUrl}${existing?.email ? ` (${existing.email})` : ""}`,
      );
    } else {
      console.log(`velloo logout: not logged in to ${cloudUrl}`);
    }
  },
});
