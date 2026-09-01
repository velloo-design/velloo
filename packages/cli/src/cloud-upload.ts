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

export const VERSION_UPLOAD_TIMEOUT_MS = 60_000;
export const VERSION_UPLOAD_RETRIES = 1;

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
  /** Test seam; production uploads get a one-minute response deadline. */
  uploadTimeoutMs?: number;
  /** Test seam; production retries one transient version-upload failure. */
  uploadRetries?: number;
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

  const upload = await uploadVersionWithRetry({
    url: `${baseUrl}/v1/links/${link.slug}/versions`,
    headers: authorized,
    form,
    timeoutMs: opts.uploadTimeoutMs ?? VERSION_UPLOAD_TIMEOUT_MS,
    retries: opts.uploadRetries ?? VERSION_UPLOAD_RETRIES,
  });
  const uploadRes = upload.response;
  if (uploadRes.status !== 201) {
    const body = (await uploadRes.json().catch(() => ({}))) as { message?: string };
    const slotChangedAfterTransientFailure =
      upload.transientFailures > 0 &&
      uploadRes.status === 409 &&
      /slot changed|already has a version/i.test(body.message ?? "");
    if (slotChangedAfterTransientFailure) {
      throw new Error(
        "upload confirmation was lost and the retry found the publish slot changed — the publish may have succeeded; check your published boards before retrying",
      );
    }
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
  const uploaded = (await uploadRes.json()) as {
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
    files: uploaded.files,
    bytes: uploaded.bytes,
    shareUrl: uploaded.url.startsWith("http") ? uploaded.url : `${baseUrl}${uploaded.url}`,
    ...(uploaded.tier !== undefined ? { tier: uploaded.tier } : {}),
    ...(uploaded.history !== undefined ? { history: uploaded.history } : {}),
  };
}

interface VersionUploadAttempt {
  response: Response;
  transientFailures: number;
}

/** Retry only failures that can plausibly recover without changing the request. */
async function uploadVersionWithRetry(opts: {
  url: string;
  headers: Record<string, string>;
  form: FormData;
  timeoutMs: number;
  retries: number;
}): Promise<VersionUploadAttempt> {
  const attempts = Math.max(1, Math.floor(opts.retries) + 1);
  let transientFailures = 0;
  let lastNetworkError = "unknown network error";
  let lastTimedOut = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(1, opts.timeoutMs),
    );
    try {
      const response = await fetch(opts.url, {
        method: "POST",
        headers: opts.headers,
        body: opts.form,
        signal: controller.signal,
      });
      if (response.status < 500 || attempt === attempts) {
        return { response, transientFailures };
      }
      transientFailures += 1;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      transientFailures += 1;
      lastTimedOut = timedOut;
      lastNetworkError = error instanceof Error ? error.message : String(error);
      if (attempt === attempts) {
        const retried = attempts > 1 ? ` after ${attempts} attempts` : "";
        if (timedOut) {
          throw new CloudUnreachableError(
            `version upload timed out after ${formatDuration(opts.timeoutMs)}${retried} — check your connection and try again`,
          );
        }
        throw new CloudUnreachableError(
          `version upload could not reach the cloud${retried} (${lastNetworkError}) — check your connection and try again`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // The loop always returns or throws. Keep TypeScript honest if its bounds
  // analysis changes, while retaining the most useful terminal verdict.
  throw new CloudUnreachableError(
    lastTimedOut
      ? `version upload timed out after ${formatDuration(opts.timeoutMs)} — check your connection and try again`
      : `version upload could not reach the cloud (${lastNetworkError}) — check your connection and try again`,
  );
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.max(1, Math.round(ms))}ms`;
}
