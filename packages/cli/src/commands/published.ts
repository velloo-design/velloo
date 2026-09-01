import { defineCommand } from "citty";
import { defaultCloudUrl, publishedBoardsUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { listPublishedDesigns, publishedDesignSubtitle } from "../cloud-published.ts";
import { CloudUnreachableError } from "../cloud-upload.ts";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "published",
    description: "List published designs in velloo-cloud",
  },
  args: {
    url: {
      type: "string",
      description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or the built-in default)",
    },
    token: {
      type: "string",
      description: "velloo-cloud access token (default: $VELLOO_CLOUD_TOKEN)",
    },
  },
  async run({ args }) {
    const baseUrl = args.url ? args.url.replace(/\/+$/, "") : defaultCloudUrl();
    const token =
      args.token ?? process.env.VELLOO_CLOUD_TOKEN ?? (await loadCredential(baseUrl))?.token;
    if (!token) fail("published", "not logged in. Run `velloo login` first.");

    const designs = await listPublishedDesigns({ baseUrl, token }).catch((error: unknown) => {
      if (error instanceof CloudUnreachableError) {
        fail("published", `cannot reach ${baseUrl} (${error.message})`);
      }
      fail("published", error instanceof Error ? error.message : String(error));
    });
    if (designs.length === 0) {
      console.log("velloo published: no published designs.");
      console.log(`  ${await publishedBoardsUrl(baseUrl)}`);
      return;
    }

    console.log(`velloo published: ${designs.length} design${designs.length === 1 ? "" : "s"}`);
    for (const design of designs) {
      const access = design.passwordProtected
        ? "password protected"
        : design.visibility === "private"
          ? "private"
          : "public";
      console.log(`\n${design.title?.trim() || "Untitled design"}`);
      console.log(`  ${access}`);
      console.log(`  ${publishedDesignSubtitle(design)}`);
      console.log(`  ${design.url}`);
    }
    console.log(`\nManage in velloo-cloud: ${await publishedBoardsUrl(baseUrl)}`);
  },
});
