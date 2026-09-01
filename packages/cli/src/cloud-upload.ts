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

// A 5xx is the cloud's trouble, not the user's bundle — say so instead of
// leaving a bare "internal error".
const serverTroubleHint = (status: number): string =>
  status >= 500 ? " — the cloud is having trouble; check its status or try again later" : "";

export interface CloudLinkRequest {
  slug?: string;
  folderId?: string;
  publishMode: "new" | "update";
  /** Latest version observed when the user selected an update destination. */
  expectedVersionId?: string | null;
  title: string;
  visibility: "public" | "private";
  /** Explicit collaboration context; omitted keeps the board personal. */
  teamId?: string;
  /**
   * Password protection, independent of visibility — anyone who has it can
   * view. Only ever sent, never echoed back or stored locally.
   */
  password?: string;
  passwordExpiresAt?: string;
}

export interface CloudPublishSlot {
  slug: string;
  url: string;
  title: string;
  teamId: string | null;
  visibility: "public" | "private";
  passwordProtected: boolean;
  latestVersionId: string | null;
  lastPublishedAt: string | null;
  context: {
    boardIds: string[];
    selectionFingerprint: string | null;
    contextKnown: boolean;
    repo: string | null;
    branch: string | null;
  };
}

export interface CloudPublishDestinations {
  effectiveTeamId: string | null;
  slots: CloudPublishSlot[];
}

export async function listPublishDestinations(opts: {
  baseUrl: string;
  token: string;
  folderId: string;
  teamId?: string;
}): Promise<CloudPublishDestinations> {
  const query = new URLSearchParams({ folderId: opts.folderId });
  if (opts.teamId) query.set("teamId", opts.teamId);
  const res = await fetch(`${opts.baseUrl}/v1/publish-destinations?${query}`, {
    headers: { authorization: `Bearer ${opts.token}` },
  }).catch((error: unknown) => {
    throw new CloudUnreachableError(error instanceof Error ? error.message : String(error));
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `could not list publish destinations (${res.status}): ${body.message ?? "unknown"}${serverTroubleHint(res.status)}`,
    );
  }
  return (await res.json()) as CloudPublishDestinations;
}

export interface LinkUploadOutcome {
  link: { slug: string; visibility: "public" | "private"; passwordProtected: boolean };
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
    throw new Error(
      `link creation failed (${createRes.status}): ${body.message ?? "unknown"}${serverTroubleHint(createRes.status)}`,
    );
  }
  const created = createRes.status === 201;
  let link = (await createRes.json()) as {
    slug: string;
    visibility?: "public" | "private";
    passwordProtected?: boolean;
  };

  if (opts.link.publishMode === "new" && !created) {
    throw new Error("the cloud reused a link even though a new publish destination was requested");
  }
  if (opts.link.publishMode === "update" && created) {
    await fetch(`${baseUrl}/v1/links/${link.slug}`, {
      method: "DELETE",
      headers: authorized,
    }).catch(() => {});
    throw new Error("the cloud created a link even though an existing destination was selected");
  }

  // A folder reuses its stable link. The privacy choice made for this publish
  // still has to win over the link's previous access mode, otherwise choosing
  // Private in the CLI/canvas could silently leave an old public link open.
  if (!created) {
    const accessRes = await fetch(`${baseUrl}/v1/links/${link.slug}/access`, {
      method: "PUT",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({
        visibility: opts.link.visibility,
        password: opts.link.password ?? null,
        passwordExpiresAt: opts.link.password ? (opts.link.passwordExpiresAt ?? null) : null,
        expectedVersionId: opts.link.expectedVersionId ?? null,
      }),
    });
    if (!accessRes.ok) {
      const body = (await accessRes.json().catch(() => ({}))) as { message?: string };
      throw new Error(
        `privacy update failed (${accessRes.status}): ${body.message ?? "unknown"}${serverTroubleHint(accessRes.status)}`,
      );
    }
    const access = (await accessRes.json()) as {
      visibility: "public" | "private";
      passwordProtected: boolean;
    };
    link = { ...link, ...access };
  }

  form.append("publishMode", opts.link.publishMode);
  if (opts.link.expectedVersionId) {
    form.append("expectedVersionId", opts.link.expectedVersionId);
  }

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
    throw new Error(
      `upload failed (${uploadRes.status}): ${body.message ?? "unknown"}${serverTroubleHint(uploadRes.status)}`,
    );
  }
  const upload = (await uploadRes.json()) as {
    files: number;
    bytes: number;
    url: string;
    tier?: string;
    history?: { retained: boolean; versions: number; pruned: number };
  };
  return {
    link: {
      slug: link.slug,
      visibility: link.visibility ?? opts.link.visibility,
      passwordProtected: link.passwordProtected ?? opts.link.password != null,
    },
    created,
    files: upload.files,
    bytes: upload.bytes,
    shareUrl: upload.url.startsWith("http") ? upload.url : `${baseUrl}${upload.url}`,
    ...(upload.tier !== undefined ? { tier: upload.tier } : {}),
    ...(upload.history !== undefined ? { history: upload.history } : {}),
  };
}
