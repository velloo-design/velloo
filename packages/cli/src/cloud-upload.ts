/**
 * The link-create → upload → cleanup-on-fail flow shared by `velloo publish`
 * and `velloo ci`: `POST /v1/links` creates a share link (or returns the
 * folder's existing one when a `folderId` travels), then
 * `POST /v1/links/:slug/versions` stores the multipart bundle. A failed upload
 * deletes a link this call created — a link with no version is a dead /s/
 * page. Throws (CloudUnreachableError when the cloud can't be reached at link
 * creation) instead of exiting, so each command keeps its own failure style.
 */

export class CloudUnreachableError extends Error {}

export interface CloudLinkRequest {
  slug?: string;
  folderId?: string;
  title: string;
  visibility: "public" | "private";
}

export interface LinkUploadOutcome {
  link: { slug: string; accessToken: string | null };
  /** True when this call created the link (vs. reusing the folder's existing one). */
  created: boolean;
  files: number;
  bytes: number;
  /** Absolute share URL (the cloud returns it relative in dev). */
  shareUrl: string;
  /** Effective plan + version retention, from folderId-aware clouds. */
  tier?: string;
  history?: { retained: boolean; versions: number; pruned: number };
}

export async function uploadLinkBundle(opts: {
  baseUrl: string;
  token: string;
  link: CloudLinkRequest;
  form: FormData;
}): Promise<LinkUploadOutcome> {
  const { baseUrl, token, form } = opts;
  const authorized = { authorization: `Bearer ${token}` };

  const createRes = await fetch(`${baseUrl}/v1/links`, {
    method: "POST",
    headers: authorized,
    body: JSON.stringify(opts.link),
  }).catch((error: unknown) => {
    throw new CloudUnreachableError(error instanceof Error ? error.message : String(error));
  });
  // 201 = created here; 200 = the folder's existing link — the same share URL
  // gets updated.
  if (createRes.status !== 200 && createRes.status !== 201) {
    const body = (await createRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(`link creation failed (${createRes.status}): ${body.message ?? "unknown"}`);
  }
  const created = createRes.status === 201;
  const link = (await createRes.json()) as { slug: string; accessToken: string | null };

  const uploadRes = await fetch(`${baseUrl}/v1/links/${link.slug}/versions`, {
    method: "POST",
    headers: authorized,
    body: form,
  });
  if (uploadRes.status !== 201) {
    const body = (await uploadRes.json().catch(() => ({}))) as { message?: string };
    // Clean up a link we just created so a failed upload — e.g. over the size
    // limit — doesn't leave a broken board in the user's home.
    if (created) {
      await fetch(`${baseUrl}/v1/links/${link.slug}`, {
        method: "DELETE",
        headers: authorized,
      }).catch(() => {});
    }
    throw new Error(`upload failed (${uploadRes.status}): ${body.message ?? "unknown"}`);
  }
  const upload = (await uploadRes.json()) as {
    files: number;
    bytes: number;
    url: string;
    tier?: string;
    history?: { retained: boolean; versions: number; pruned: number };
  };
  return {
    link,
    created,
    files: upload.files,
    bytes: upload.bytes,
    shareUrl: upload.url.startsWith("http") ? upload.url : `${baseUrl}${upload.url}`,
    ...(upload.tier !== undefined ? { tier: upload.tier } : {}),
    ...(upload.history !== undefined ? { history: upload.history } : {}),
  };
}
