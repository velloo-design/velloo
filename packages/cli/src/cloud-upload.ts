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
  VERSION_UPLOAD_PROGRESS_TYPE,
  VersionUploadLineSchema,
  VersionUploadResponseSchema,
} from "@velloo/protocol";
import { err, ok, type Result } from "@velloo/result";

// The deadline is for a stall, not for the whole upload: a 27 MB bundle on a
// slow uplink can take minutes and still be going fine. It runs from the last
// chunk sent or line received, so it only fires on a minute of silence.
const VERSION_UPLOAD_IDLE_MS = 60_000;
const VERSION_UPLOAD_RETRIES = 1;
const UPLOAD_CHUNK_BYTES = 256 * 1024;

/** `sending` counts bytes; the cloud's `processing` and `storing` count files. */
export interface UploadProgress {
  stage: "sending" | "processing" | "storing";
  done: number;
  total: number;
}

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
  /** How the version upload is going: bytes sent, then the cloud's own steps. */
  onProgress?: (progress: UploadProgress) => void;
  /** Test seam; production gives up after a minute with nothing sent or received. */
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

  // A link this call created and never stored a version on is a dead /s/ page
  // that still counts against the plan's boards — whether the upload was
  // refused or never answered.
  const discardCreatedLink = async (): Promise<void> => {
    if (!created) return;
    await fetch(`${baseUrl}/v1/links/${link.slug}`, {
      method: "DELETE",
      headers: authorized,
    }).catch(() => {});
  };

  const attempt = await uploadVersionWithRetry({
    url: `${baseUrl}/v1/links/${link.slug}/versions`,
    headers: authorized,
    form,
    idleMs: opts.uploadTimeoutMs ?? VERSION_UPLOAD_IDLE_MS,
    retries: opts.uploadRetries ?? VERSION_UPLOAD_RETRIES,
    onProgress: opts.onProgress ?? (() => {}),
  });
  if (!attempt.ok) {
    await discardCreatedLink();
    return attempt;
  }
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
    await discardCreatedLink();
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
  idleMs: number;
  retries: number;
  onProgress: (progress: UploadProgress) => void;
}): Promise<Result<VersionUploadAttempt, CloudError>> {
  const attempts = Math.max(1, Math.floor(opts.retries) + 1);
  let transientFailures = 0;
  let lastNetworkError = "unknown network error";
  let lastTimedOut = false;
  const stalled = (retried: string) =>
    unreachable(`nothing sent or received for ${formatDuration(opts.idleMs)}${retried}`, {
      url: opts.url,
      timedOut: true,
    });

  // Encoded once, so a retry sends the same bytes and progress has a total.
  const encoded = new Response(opts.form);
  const contentType = encoded.headers.get("content-type") ?? "multipart/form-data";
  const bundle = new Uint8Array(await encoded.arrayBuffer());

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stillGoing = (graceMs = 0) => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          timedOut = true;
          controller.abort();
        },
        Math.max(1, opts.idleMs + graceMs),
      );
    };
    stillGoing();
    // fetch pulls the next chunk only once the socket has taken the last
    // one, so a pull is the closest the client gets to "these bytes left".
    // The socket's buffers take the first few MB at once, though, so after
    // the last pull those are still draining with nothing to show for it —
    // on a slow uplink for longer than the deadline. The last pull gets twice
    // the time they need at the rate measured since they filled.
    let sent = 0;
    let lastPullAt = performance.now();
    let buffered: { at: number; sent: number } | null = null;
    const drainMs = (now: number): number => {
      if (!buffered || now <= buffered.at) return 0;
      const rate = (sent - buffered.sent) / (now - buffered.at);
      return rate > 0 ? (2 * buffered.sent) / rate : 0;
    };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(stream) {
          if (sent >= bundle.byteLength) {
            stream.close();
            return;
          }
          const now = performance.now();
          if (!buffered && now - lastPullAt > 20) buffered = { at: now, sent };
          lastPullAt = now;
          const chunk = bundle.subarray(sent, sent + UPLOAD_CHUNK_BYTES);
          stream.enqueue(chunk);
          sent += chunk.byteLength;
          stillGoing(sent >= bundle.byteLength ? drainMs(now) : 0);
          opts.onProgress({ stage: "sending", done: sent, total: bundle.byteLength });
        },
      },
      { highWaterMark: 0 },
    );
    try {
      const response = await fetch(opts.url, {
        method: "POST",
        headers: {
          ...opts.headers,
          accept: `${VERSION_UPLOAD_PROGRESS_TYPE}, application/json`,
          "content-type": contentType,
          "content-length": String(bundle.byteLength),
        },
        body,
        signal: controller.signal,
      });
      stillGoing();
      const answered = isProgressStream(response)
        ? await readProgressStream(response, stillGoing, opts.onProgress)
        : ok(response);
      if (!answered.ok) return answered;
      if (answered.value.status < 500 || attempt === attempts) {
        return ok({ response: answered.value, transientFailures });
      }
      transientFailures += 1;
      await answered.value.body?.cancel().catch(() => {});
    } catch (error) {
      transientFailures += 1;
      lastTimedOut = timedOut;
      lastNetworkError = error instanceof Error ? error.message : String(error);
      if (attempt === attempts) {
        const retried = attempts > 1 ? ` after ${attempts} attempts` : "";
        return err(
          timedOut
            ? stalled(retried)
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
      ? stalled("")
      : unreachable(`version upload: ${lastNetworkError}`, { url: opts.url }),
  );
}

function isProgressStream(response: Response): boolean {
  return (
    response.status === 200 &&
    (response.headers.get("content-type") ?? "").startsWith(VERSION_UPLOAD_PROGRESS_TYPE)
  );
}

/**
 * Follow a cloud's progress lines to its `result`, and hand that back as the
 * plain response it stands for, so everything after reads one shape. A
 * stream that ends without one is a dropped connection: it throws, and the
 * caller treats it like any other.
 */
async function readProgressStream(
  response: Response,
  stillGoing: () => void,
  onProgress: (progress: UploadProgress) => void,
): Promise<Result<Response, CloudError>> {
  if (!response.body) throw new Error("the cloud's upload answer had no body");
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of response.body) {
    stillGoing();
    pending += decoder.decode(chunk, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const text = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (!text) continue;
      const line = parseUploadLine(text);
      if (!line) return err(protocolViolation(`unreadable upload progress line: ${text}`));
      if (line.type === "progress") {
        onProgress({ stage: line.stage, done: line.done, total: line.total });
        continue;
      }
      return ok(
        new Response(JSON.stringify(line.body ?? null), {
          status: line.status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }
  throw new Error("the cloud closed the upload before answering");
}

function parseUploadLine(text: string) {
  try {
    const parsed = VersionUploadLineSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${Math.max(1, Math.round(ms))}ms`;
}
