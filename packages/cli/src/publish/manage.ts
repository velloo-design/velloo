import { confirm, isCancel, select } from "@clack/prompts";
import { type CloudError, describeCloudError } from "@velloo/protocol";
import { defaultCloudUrl, publishedBoardsUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import {
  type CloudPublishedDesign,
  listPublishedDesigns,
  publishedDesignSubtitle,
  unpublishDesign,
} from "../cloud-published.ts";
import { fail } from "../fail.ts";

/**
 * The read/remove half of `velloo publish` — what used to be the separate
 * `published` and `unpublish` commands. Publishing, listing what you published
 * and taking one down are three faces of one thing; three top-level verbs made
 * the CLI wider without making any of them easier to find.
 */

interface CloudArgs {
  url?: string | undefined;
  token?: string | undefined;
}

async function resolveCloud(
  command: string,
  args: CloudArgs,
): Promise<{ baseUrl: string; token: string }> {
  const baseUrl = args.url ? args.url.replace(/\/+$/, "") : defaultCloudUrl();
  const token =
    args.token ?? process.env.VELLOO_CLOUD_TOKEN ?? (await loadCredential(baseUrl))?.token;
  if (!token) fail(command, "not logged in. Run `velloo login` first.");
  return { baseUrl, token };
}

/** One rendering for every typed cloud failure this command can hit. */
function cloudFailure(command: string, error: CloudError): never {
  fail(command, describeCloudError(error));
}

/** `velloo publish --list` */
export async function listPublished(args: CloudArgs): Promise<void> {
  const { baseUrl, token } = await resolveCloud("publish", args);
  const listed = await listPublishedDesigns({ baseUrl, token });
  if (!listed.ok) cloudFailure("publish", listed.error);
  const designs = listed.value;
  if (designs.length === 0) {
    console.log("velloo publish: no published designs.");
    console.log(`  ${await publishedBoardsUrl(baseUrl)}`);
    return;
  }

  console.log(`velloo publish: ${designs.length} design${designs.length === 1 ? "" : "s"}`);
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
}

/** `velloo publish --remove [share-url]` */
export async function removePublished(
  args: CloudArgs & { design?: string | undefined; yes?: boolean | undefined },
): Promise<void> {
  const { baseUrl, token } = await resolveCloud("publish", args);
  const interactive = Boolean(process.stdin.isTTY);
  if (!interactive && !args.design) {
    fail("publish", "pass the full share URL and --yes when there is no interactive terminal");
  }
  if (!interactive && args.yes !== true) {
    fail("publish", "refusing to remove a published design without --yes");
  }

  const listed = await listPublishedDesigns({ baseUrl, token });
  if (!listed.ok) cloudFailure("publish", listed.error);
  const designs = listed.value;
  const manageable = designs.filter((design) => design.canManage);
  if (manageable.length === 0) {
    fail(
      "publish",
      `there are no published designs you can remove. Manage boards at ${await publishedBoardsUrl(baseUrl)}`,
    );
  }

  let target: CloudPublishedDesign | null;
  if (args.design) {
    target = designFromReference(args.design, designs);
    if (!target) {
      fail(
        "publish",
        `that share URL is not in your published designs. Manage boards at ${await publishedBoardsUrl(baseUrl)}`,
      );
    }
    if (!target.canManage) fail("publish", "you do not have permission to remove that design");
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
    if (!target) fail("publish", "cancelled");
  }

  if (args.yes !== true) {
    const approved = await confirm({
      message: `Unpublish “${target.title?.trim() || "Untitled design"}”? Its share URL will stop working.`,
      initialValue: false,
    });
    if (isCancel(approved) || !approved) fail("publish", "cancelled");
  }

  const removed = await unpublishDesign({ baseUrl, token, slug: target.slug });
  if (!removed.ok) cloudFailure("publish", removed.error);
  console.log(`velloo publish: removed ${target.title?.trim() || "Untitled design"}`);
  console.log(`  ${target.url}`);
}

export function resolveUnpublishSelection(
  value: string | null,
  designs: CloudPublishedDesign[],
): CloudPublishedDesign | null {
  return value === null ? null : (designs.find((design) => design.slug === value) ?? null);
}

/** Match a design by its share URL, ignoring query/hash and a trailing slash. */
export function designFromReference(
  reference: string,
  designs: CloudPublishedDesign[],
): CloudPublishedDesign | null {
  if (!/^https?:\/\//i.test(reference.trim())) return null;
  const normalize = (raw: string): string | null => {
    try {
      const url = new URL(raw.trim());
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  };
  const normalized = normalize(reference);
  if (normalized === null) return null;
  return designs.find((design) => normalize(design.url) === normalized) ?? null;
}
