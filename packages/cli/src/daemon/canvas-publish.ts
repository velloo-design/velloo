import { boardLimitFrom, type CloudError, describeCloudError } from "@velloo/protocol";
import type {
  CanvasAuth,
  CanvasCloudAccess,
  CanvasPublish,
  CanvasPublishProgress,
  CanvasPublishRequest,
  CanvasPublishResult,
  PublishHost,
} from "@velloo/server";
import { boardLimitReached, signInRequired } from "@velloo/server";
import { loadCredential } from "../cloud-credentials.ts";
import { listPublishedDesigns, unpublishDesign } from "../cloud-published.ts";
import { listPublishDestinations } from "../cloud-upload.ts";
import { gitContext, listTeams, PUBLISH_VIEWPORT, publishDesign } from "../publish/core.ts";
import { describePublishError } from "../publish/errors.ts";

/**
 * The canvas's Publish action, running the same core `velloo publish` does.
 *
 * The CLI implements it because it owns the credential and the cloud
 * transport; the daemon lends it the render pipeline (see {@link PublishHost}),
 * so a publish from the canvas reuses the folder and Tailwind build already in
 * memory instead of loading everything a second time.
 *
 * The pooled Chromium is deliberately left open afterwards — the daemon is
 * long-lived and the next capture (a publish, an export, a screenshot) reuses
 * it. Only one-shot commands close it.
 *
 * This is the boundary where Results become throws: `CanvasPublish` is an RPC
 * surface the canvas calls, and its contract is a rejected promise. The typed
 * error is rendered here, once, rather than each failure inventing its own
 * message on the way out.
 */
export function createCanvasPublish(cloudUrl: string, auth: CanvasAuth): CanvasPublish {
  const tokenFor = async (): Promise<string | undefined> => (await loadCredential(cloudUrl))?.token;

  /**
   * A stored token is not the same as a usable one. `auth.status()` already
   * asks the cloud (and caches the answer for a minute), so reusing it here
   * costs nothing and keeps the publish dialog and the account menu from
   * disagreeing about whether the user is signed in.
   *
   * `verified: null` — the cloud could not be asked — counts as ready: the
   * local credential stands, and refusing to publish because the network
   * blinked would be worse than letting the attempt fail with a real reason.
   */
  const access = async (): Promise<CanvasCloudAccess> => {
    if (!(await tokenFor())) return { state: "signed-out" };
    const status = await auth.status().catch(() => null);
    return status?.verified === false ? { state: "expired" } : { state: "ready" };
  };

  /**
   * Results become throws at this boundary — `CanvasPublish` is an RPC surface
   * whose contract is a rejected promise. A `LoggedOut` keeps its identity on
   * the way out so the canvas can answer it with a sign-in.
   */
  const rejection = (error: CloudError): Error =>
    error.kind === "LoggedOut"
      ? signInRequired("expired", describeCloudError(error))
      : new Error(describeCloudError(error));

  /** Newest first; a link the cloud couldn't date sorts last rather than first. */
  const publishedAt = (value: string | null): number => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  return {
    access,

    async teams() {
      const token = await tokenFor();
      if (!token) return [];
      const listed = await listTeams(cloudUrl, token);
      // A team list the canvas can't fetch is not worth failing the dialog
      // over — it falls back to the default team.
      return listed.ok ? listed.value : [];
    },

    async published() {
      const token = await tokenFor();
      if (!token) throw signInRequired("signed-out", "not signed in to velloo-cloud");
      const listed = await listPublishedDesigns({ baseUrl: cloudUrl, token });
      if (!listed.ok) throw rejection(listed.error);
      return listed.value
        .map((design) => ({
          slug: design.slug,
          title: design.title ?? "",
          url: design.url,
          visibility: design.visibility,
          passwordProtected: design.passwordProtected,
          canManage: design.canManage,
          lastPublishedAt: design.lastPublishedAt,
        }))
        .sort(
          (left, right) => publishedAt(right.lastPublishedAt) - publishedAt(left.lastPublishedAt),
        );
    },

    async unpublish(slug) {
      const token = await tokenFor();
      if (!token) throw signInRequired("signed-out", "not signed in to velloo-cloud");
      const removed = await unpublishDesign({ baseUrl: cloudUrl, token, slug });
      if (!removed.ok) throw rejection(removed.error);
    },

    async destinations(host) {
      const token = await tokenFor();
      if (!token) throw signInRequired("signed-out", "not signed in to velloo-cloud");
      const provenance = gitContext(host.folder.root);
      const folderId = host.folder.config.folderId;
      if (!folderId) {
        const teams = await listTeams(cloudUrl, token);
        if (!teams.ok) throw rejection(teams.error);
        return {
          effectiveTeamId: teams.value.find((team) => team.isDefault)?.id ?? null,
          provenance,
          slots: [],
        };
      }
      const listed = await listPublishDestinations({
        baseUrl: cloudUrl,
        token,
        folderId,
      });
      if (!listed.ok) throw rejection(listed.error);
      return { ...listed.value, provenance };
    },

    async run(
      host: PublishHost,
      request: CanvasPublishRequest,
      onProgress: (progress: CanvasPublishProgress) => void,
      onWarning: (message: string) => void,
    ): Promise<CanvasPublishResult> {
      const token = await tokenFor();
      if (!token) {
        throw signInRequired(
          "signed-out",
          "not signed in to velloo-cloud — sign in from the account menu first.",
        );
      }

      // Capture counters arrive without a step label, so carry the last one.
      let step = "start";
      let message = "starting";

      const published = await publishDesign(
        { baseUrl: cloudUrl, token },
        {
          folder: host.folder,
          providers: host.providers,
          defaultProvider: host.defaultProvider,
          snapshotCss: host.snapshotCss,
        },
        {
          boardIds: request.boardIds,
          ...(request.title ? { title: request.title } : {}),
          visibility: request.visibility,
          ...(request.password ? { password: request.password } : {}),
          destination: request.destination,
          ...(request.teamId ? { teamId: request.teamId } : {}),
          provenance: gitContext(host.folder.root),
          viewport: PUBLISH_VIEWPORT,
        },
        (event) => {
          if (event.kind === "warn") {
            onWarning(event.message);
            return;
          }
          // A folderId assignment is worth telling the user about, but it is
          // not a problem — same channel, since the canvas shows both as notes.
          if (event.kind === "note") {
            onWarning(event.message);
            return;
          }
          // The canvas already shows provenance in its publish dialog, so
          // repeating it as a notice would just be noise.
          if (event.kind === "info") return;
          if (event.kind === "capture") {
            onProgress({ step, message, capture: { done: event.done, total: event.total } });
            return;
          }
          step = event.step;
          message = event.message;
          onProgress({ step, message });
        },
      );
      // Two failures are the user's to clear rather than ours to report: a
      // credential revoked during the minutes a capture pass takes, and a plan
      // whose board slots are all spoken for. Both keep their identity out of
      // here so the canvas can offer the fix instead of the sentence.
      if (!published.ok) {
        const reason = describePublishError(published.error);
        if (published.error.kind === "LoggedOut") throw signInRequired("expired", reason);
        const limit =
          published.error.kind === "HttpFailure" ? boardLimitFrom(published.error) : null;
        if (limit) throw boardLimitReached(limit, reason);
        throw new Error(reason);
      }
      const outcome = published.value;

      return {
        // One clickable link, and nothing secret in it: what the link asks of
        // a visitor is a property of the link now, not of the URL.
        shareUrl: outcome.shareUrl,
        visibility: outcome.visibility,
        passwordProtected: outcome.passwordProtected,
        files: outcome.files,
        bytes: outcome.bytes,
        screenshots: outcome.screenshots,
        boards: outcome.boards,
        screens: outcome.screens,
        created: outcome.created,
        ...(outcome.tier !== undefined ? { tier: outcome.tier } : {}),
        ...(outcome.history !== undefined ? { history: outcome.history } : {}),
      };
    },
  };
}
