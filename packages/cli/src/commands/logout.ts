import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import {
  clearCredentials,
  deleteCredential,
  loadCredential,
  normalizeCloudUrl,
} from "../cloud-credentials.ts";

export default defineCommand({
  meta: {
    name: "logout",
    description: "Log out of velloo-cloud (removes the saved CLI token)",
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
    if (await deleteCredential(cloudUrl)) {
      console.log(
        `velloo logout: logged out of ${cloudUrl}${existing?.email ? ` (${existing.email})` : ""}`,
      );
    } else {
      console.log(`velloo logout: not logged in to ${cloudUrl}`);
    }
  },
});
