import { CloudUnreachableError } from "./cloud-upload.ts";

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

const troubleHint = (status: number): string =>
  status >= 500 ? " — the cloud is having trouble; try again later" : "";

export async function listPublishedDesigns(opts: {
  baseUrl: string;
  token: string;
}): Promise<CloudPublishedDesign[]> {
  const res = await fetch(`${opts.baseUrl}/v1/links`, {
    headers: { authorization: `Bearer ${opts.token}` },
  }).catch((error: unknown) => {
    throw new CloudUnreachableError(error instanceof Error ? error.message : String(error));
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `could not list published designs (${res.status}): ${body.message ?? "unknown"}${troubleHint(res.status)}`,
    );
  }
  const body = (await res.json()) as { links?: CloudPublishedDesign[] };
  return (body.links ?? [])
    .filter((link) => link.published)
    .map((link) => ({
      ...link,
      url: link.url.startsWith("http") ? link.url : `${opts.baseUrl}${link.url}`,
    }));
}

export async function unpublishDesign(opts: {
  baseUrl: string;
  token: string;
  slug: string;
}): Promise<void> {
  const res = await fetch(`${opts.baseUrl}/v1/links/${encodeURIComponent(opts.slug)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${opts.token}` },
  }).catch((error: unknown) => {
    throw new CloudUnreachableError(error instanceof Error ? error.message : String(error));
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `could not unpublish design (${res.status}): ${body.message ?? "unknown"}${troubleHint(res.status)}`,
    );
  }
}
