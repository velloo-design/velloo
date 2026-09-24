/**
 * The link-create → upload → cleanup-on-fail flow shared by `velloo publish`
 * and publishing: `POST /v1/links` creates a share link (or returns the
 * folder's existing one when a `folderId` travels), then
 * `POST /v1/links/:slug/versions` stores the multipart bundle. A failed upload
 * deletes a link this call created — a link with no version is a dead /s/
 * page.
 *
 * Returns `Result<T, CloudError>` rather than throwing, so the failure modes
 * are in the signature and each command renders them through one place
 * (`describeCloudError`) instead of matching on message text.
 */
import {
  type CloudError,
  type CloudPublishDestinations,
  cloudFailure,
  cloudFetch,
  cloudJson,
  httpFailureFrom,
  LinkAccessResponseSchema,
  type LinkAudienceEntry,
  LinkResponseSchema,
  PublishDestinationsResponseSchema,
  protocolViolation,
  readFailure,
  unreachable,
  uploadRaceLost,
  VersionUploadResponseSchema,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";

const VERSION_UPLOAD_TIMEOUT_MS = 60_000;
const VERSION_UPLOAD_RETRIES = 1;

export interface CloudLinkRequest {
  slug?: string | undefined;
  folderId?: string | undefined;
  publishMode: "new" | "update";
  /** Latest version observed when the user selected an update destination. */
  expectedVersionId?: string | null | undefined;
  title: string;
  visibility: "public" | "private";
  /** Explicit collaboration context; omitted keeps the board personal. */
  teamId?: string | undefined;
  /**
   * Who a private link is for — `[{ type: "team", id }]` makes it team-only.
   * Omitted means the cloud's default: the whole organization.
   */
  audience?: { type: "organization" | "team"; id: string }[] | undefined;
  /** Let people outside the organization comment. Omitted: off for a new link, unchanged otherwise. */
  publicComments?: boolean | undefined;
  /**
   * Password protection, independent of visibility — anyone who has it can
   * view. Only ever sent, never echoed back or stored locally.
   */
  password?: string | undefined;
  passwordExpiresAt?: string | undefined;
}

export type { CloudPublishDestinations, CloudPublishSlot } from "@velloo/protocol";

export async function listPublishDestinations(opts: {
  baseUrl: string;
  token: string;
  folderId: string;
  teamId?: string;
}): Promise<Result<CloudPublishDestinations, CloudError>> {
  const query = new URLSearchParams({ folderId: opts.folderId });
  if (opts.teamId) query.set("teamId", opts.teamId);
  return cloudFetch(
    `${opts.baseUrl}/v1/publish-destinations?${query}`,
    PublishDestinationsResponseSchema,
    { operation: "listing publish destinations", token: opts.token },
  );
}

export interface LinkUploadOutcome {
  link: {
    slug: string;
    visibility: "public" | "private";
    passwordProtected: boolean;
    audience?: LinkAudienceEntry[] | undefined;
    publicComments?: boolean | undefined;
  };
  /** True when this call created the link (vs. reusing the folder's existing one). */
  created: boolean;
  files: number;
  bytes: number;
  /** Absolute share URL (the cloud returns it relative in dev). */
  shareUrl: string;
  /** Effective plan + version retention, from folderId-aware clouds. */
  tier?: string | undefined;
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
}): Promise<Result<LinkUploadOutcome, CloudError>> {
  const { baseUrl, token, form } = opts;
  const authorized = { authorization: `Bearer ${token}` };

  const createRes = await fetch(`${baseUrl}/v1/links`, {
    method: "POST",
    headers: authorized,
    body: JSON.stringify(opts.link),
  }).catch((error: unknown) => error);
  if (!(createRes instanceof Response)) return err(unreachable(createRes, { url: baseUrl }));
  // 201 = created here; 200 = the folder's existing link — the same share URL
  // gets updated.
  if (createRes.status !== 200 && createRes.status !== 201) {
    return err(await httpFailureFrom("link creation", createRes));
  }
  const created = createRes.status === 201;
  const createdLink = await cloudJson(createRes, LinkResponseSchema, "link creation");
  if (!createdLink.ok) return createdLink;
  let link = createdLink.value;

  if (opts.link.publishMode === "new" && !created) {
    return err(
      protocolViolation(
        "the cloud reused a link even though a new publish destination was requested",
      ),
    );
  }
  if (opts.link.publishMode === "update" && created) {
    await fetch(`${baseUrl}/v1/links/${link.slug}`, {
      method: "DELETE",
      headers: authorized,
    }).catch(() => {});
    return err(
      protocolViolation(
        "the cloud created a link even though an existing destination was selected",
      ),
    );
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
        ...(opts.link.audience?.length ? { audience: opts.link.audience } : {}),
        ...(opts.link.publicComments !== undefined
          ? { publicComments: opts.link.publicComments }
          : {}),
      }),
    });
    if (!accessRes.ok) {
      return err(await httpFailureFrom("privacy update", accessRes));
    }
    const access = await cloudJson(accessRes, LinkAccessResponseSchema, "privacy update");
    if (!access.ok) return access;
    link = { ...link, ...access.value };
  }

  form.append("publishMode", opts.link.publishMode);
  if (opts.link.expectedVersionId) {
    form.append("expectedVersionId", opts.link.expectedVersionId);
  }

  const attempt = await uploadVersionWithRetry({
    url: `${baseUrl}/v1/links/${link.slug}/versions`,
    headers: authorized,
    form,
    timeoutMs: opts.uploadTimeoutMs ?? VERSION_UPLOAD_TIMEOUT_MS,
    retries: opts.uploadRetries ?? VERSION_UPLOAD_RETRIES,
  });
  if (!attempt.ok) return attempt;
  const upload = attempt.value;
  const uploadRes = upload.response;
  if (uploadRes.status !== 201) {
    // The body is read once here because the race check below needs it; the
    // typed code rides along rather than being re-fetched.
    const { detail, code } = await readFailure(uploadRes);
    const slotChangedAfterTransientFailure =
      upload.transientFailures > 0 &&
      uploadRes.status === 409 &&
      /slot changed|already has a version/i.test(detail);
    if (slotChangedAfterTransientFailure) return err(uploadRaceLost());
    // Clean up a link we just created so a failed upload — e.g. over the size
    // limit — doesn't leave a broken board in the user's home.
    if (created) {
      await fetch(`${baseUrl}/v1/links/${link.slug}`, {
        method: "DELETE",
        headers: authorized,
      }).catch(() => {});
    }
    return err(cloudFailure("upload", uploadRes.status, detail, code));
  }
  const parsed = await cloudJson(uploadRes, VersionUploadResponseSchema, "upload");
  if (!parsed.ok) return parsed;
  const uploaded = parsed.value;
  return ok({
    link: {
      slug: link.slug,
      visibility: link.visibility ?? opts.link.visibility,
      passwordProtected: link.passwordProtected ?? opts.link.password != null,
      ...(link.audience !== undefined ? { audience: link.audience } : {}),
      ...(link.publicComments !== undefined ? { publicComments: link.publicComments } : {}),
    },
    created,
    files: uploaded.files,
    bytes: uploaded.bytes,
    shareUrl: uploaded.url.startsWith("http") ? uploaded.url : `${baseUrl}${uploaded.url}`,
    ...(uploaded.tier !== undefined ? { tier: uploaded.tier } : {}),
    ...(uploaded.history !== undefined ? { history: uploaded.history } : {}),
  });
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
}): Promise<Result<VersionUploadAttempt, CloudError>> {
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
        return ok({ response, transientFailures });
      }
      transientFailures += 1;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      transientFailures += 1;
      lastTimedOut = timedOut;
      lastNetworkError = error instanceof Error ? error.message : String(error);
      if (attempt === attempts) {
        const retried = attempts > 1 ? ` after ${attempts} attempts` : "";
        return err(
          timedOut
            ? unreachable(`timed out after ${formatDuration(opts.timeoutMs)}${retried}`, {
                url: opts.url,
                timedOut: true,
              })
            : unreachable(`version upload${retried}: ${lastNetworkError}`, { url: opts.url }),
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // The loop always returns. Keep TypeScript honest if its bounds analysis
  // changes, while retaining the most useful terminal verdict.
  return err(
    lastTimedOut
      ? unreachable(`timed out after ${formatDuration(opts.timeoutMs)}`, {
          url: opts.url,
          timedOut: true,
        })
      : unreachable(`version upload: ${lastNetworkError}`, { url: opts.url }),
  );
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.max(1, Math.round(ms))}ms`;
}
