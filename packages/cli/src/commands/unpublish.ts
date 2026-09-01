import { confirm, isCancel, select } from "@clack/prompts";
import { defineCommand } from "citty";
import { defaultCloudUrl, publishedBoardsUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import {
  type CloudPublishedDesign,
  listPublishedDesigns,
  publishedDesignSubtitle,
  unpublishDesign,
} from "../cloud-published.ts";
import { CloudUnreachableError } from "../cloud-upload.ts";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "unpublish",
    description: "Remove a published design from velloo-cloud",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: "Full share URL to unpublish (picked interactively when omitted)",
    },
    yes: {
      type: "boolean",
      description: "Confirm unpublishing (required without an interactive terminal)",
    },
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
    if (!token) fail("unpublish", "not logged in. Run `velloo login` first.");
    const interactive = Boolean(process.stdin.isTTY);
    if (!interactive && !args.design) {
      fail("unpublish", "pass the full share URL and --yes when there is no interactive terminal");
    }
    if (!interactive && args.yes !== true) {
      fail("unpublish", "refusing to remove a published design without --yes");
    }

    const designs = await listPublishedDesigns({ baseUrl, token }).catch((error: unknown) => {
      cloudFailure("unpublish", baseUrl, error);
    });
    const manageable = designs.filter((design) => design.canManage);
    if (manageable.length === 0) {
      fail(
        "unpublish",
        `there are no published designs you can remove. Manage boards at ${await publishedBoardsUrl(baseUrl)}`,
      );
    }

    let target: CloudPublishedDesign | null;
    if (args.design) {
      target = designFromReference(args.design, designs);
      if (!target) {
        fail(
          "unpublish",
          `that share URL is not in your published designs. Manage boards at ${await publishedBoardsUrl(baseUrl)}`,
        );
      }
      if (!target.canManage) fail("unpublish", "you do not have permission to remove that design");
    } else {
      const value = await select({
        message: "Design to unpublish",
        options: manageable.map((design) => ({
          value: design.slug,
          label: design.title?.trim() || "Untitled design",
          hint: publishedDesignSubtitle(design),
        })),
      });
      target = resolveUnpublishSelection(isCancel(value) ? null : String(value), manageable);
      if (!target) fail("unpublish", "cancelled");
    }

    if (args.yes !== true) {
      const approved = await confirm({
        message: `Unpublish “${target.title?.trim() || "Untitled design"}”? Its share URL will stop working.`,
        initialValue: false,
      });
      if (isCancel(approved) || !approved) fail("unpublish", "cancelled");
    }

    await unpublishDesign({ baseUrl, token, slug: target.slug }).catch((error: unknown) => {
      cloudFailure("unpublish", baseUrl, error);
    });
    console.log(`velloo unpublish: removed ${target.title?.trim() || "Untitled design"}`);
    console.log(`  ${target.url}`);
  },
});

export function resolveUnpublishSelection(
  value: string | null,
  designs: CloudPublishedDesign[],
): CloudPublishedDesign | null {
  return value === null ? null : (designs.find((design) => design.slug === value) ?? null);
}

export function designFromReference(
  reference: string,
  designs: CloudPublishedDesign[],
): CloudPublishedDesign | null {
  if (!/^https?:\/\//i.test(reference.trim())) return null;
  let normalized: string;
  try {
    const url = new URL(reference.trim());
    url.search = "";
    url.hash = "";
    normalized = url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
  return (
    designs.find((design) => {
      try {
        const url = new URL(design.url);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "") === normalized;
      } catch {
        return false;
      }
    }) ?? null
  );
}

function cloudFailure(command: string, baseUrl: string, error: unknown): never {
  if (error instanceof CloudUnreachableError) {
    fail(command, `cannot reach ${baseUrl} (${error.message})`);
  }
  fail(command, error instanceof Error ? error.message : String(error));
}
