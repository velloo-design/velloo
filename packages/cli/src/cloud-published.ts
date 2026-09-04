import { err, ok, type Result } from "@velloo/result";
import { type CloudError, httpFailureFrom, unreachable } from "./cloud-errors.ts";

export interface CloudPublishedDesign {
  slug: string;
  title: string | null;
  url: string;
  visibility: "public" | "private";
  passwordProtected: boolean;
  canManage: boolean;
  mine: boolean;
  ownerEmail?: string | null;
  git?: { repo?: string; branch?: string } | null;
  published: boolean;
  lastPublishedAt: string | null;
}

/** Human context shared by list output and the unpublish picker. */
export function publishedDesignSubtitle(
  design: Pick<CloudPublishedDesign, "lastPublishedAt" | "ownerEmail" | "git">,
): string {
  const published = design.lastPublishedAt
    ? `Published ${design.lastPublishedAt}`
    : "Publish time unavailable";
  const publisher = design.ownerEmail?.trim()
    ? `by ${design.ownerEmail.trim()}`
    : "publisher unavailable";
  const repo = design.git?.repo?.trim();
  const branch = design.git?.branch?.trim();
  const source = repo ? `repo ${repo}${branch ? ` (${branch})` : ""}` : "repository unavailable";
  return `${published} · ${publisher} · ${source}`;
}

export async function listPublishedDesigns(opts: {
  baseUrl: string;
  token: string;
}): Promise<Result<CloudPublishedDesign[], CloudError>> {
  const res = await fetch(`${opts.baseUrl}/v1/links`, {
    headers: { authorization: `Bearer ${opts.token}` },
  }).catch((error: unknown) => error);
  if (!(res instanceof Response)) return err(unreachable(res, { url: opts.baseUrl }));
  if (!res.ok) {
    return err(await httpFailureFrom("listing published designs", res));
  }
  const body = (await res.json()) as { links?: CloudPublishedDesign[] };
  return ok(
    (body.links ?? [])
      .filter((link) => link.published)
      .map((link) => ({
        ...link,
        url: link.url.startsWith("http") ? link.url : `${opts.baseUrl}${link.url}`,
      })),
  );
}

export async function unpublishDesign(opts: {
  baseUrl: string;
  token: string;
  slug: string;
}): Promise<Result<void, CloudError>> {
  const res = await fetch(`${opts.baseUrl}/v1/links/${encodeURIComponent(opts.slug)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${opts.token}` },
  }).catch((error: unknown) => error);
  if (!(res instanceof Response)) return err(unreachable(res, { url: opts.baseUrl }));
  if (!res.ok) {
    return err(await httpFailureFrom("unpublishing the design", res));
  }
  return ok(undefined);
}
