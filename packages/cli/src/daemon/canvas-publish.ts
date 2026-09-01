import type {
  CanvasPublish,
  CanvasPublishProgress,
  CanvasPublishRequest,
  CanvasPublishResult,
  PublishHost,
} from "@velloo/server";
import { loadCredential } from "../cloud-credentials.ts";
import { CloudUnreachableError } from "../cloud-upload.ts";
import { listTeams, PUBLISH_VIEWPORT, publishDesign } from "../publish/core.ts";

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
 */
export function createCanvasPublish(cloudUrl: string): CanvasPublish {
  const tokenFor = async (): Promise<string | undefined> => (await loadCredential(cloudUrl))?.token;

  return {
    async ready() {
      return Boolean(await tokenFor());
    },

    async teams() {
      const token = await tokenFor();
      if (!token) return [];
      return listTeams(cloudUrl, token);
    },

    async run(
      host: PublishHost,
      request: CanvasPublishRequest,
      onProgress: (progress: CanvasPublishProgress) => void,
      onWarning: (message: string) => void,
    ): Promise<CanvasPublishResult> {
      const token = await tokenFor();
      if (!token) {
        throw new Error("not signed in to velloo-cloud — sign in from the account menu first.");
      }

      // Capture counters arrive without a step label, so carry the last one.
      let step = "start";
      let message = "starting";

      try {
        const outcome = await publishDesign(
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
            ...(request.teamId ? { teamId: request.teamId } : {}),
            viewport: PUBLISH_VIEWPORT,
            screenshots: request.screenshots,
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
            if (event.kind === "capture") {
              onProgress({ step, message, capture: { done: event.done, total: event.total } });
              return;
            }
            step = event.step;
            message = event.message;
            onProgress({ step, message });
          },
        );

        return {
          // The canvas shows one clickable link, so a private link's key
          // travels in it rather than as a field the UI has to remember to add.
          shareUrl: outcome.accessToken
            ? `${outcome.shareUrl}?k=${outcome.accessToken}`
            : outcome.shareUrl,
          files: outcome.files,
          bytes: outcome.bytes,
          screenshots: outcome.screenshots,
          boards: outcome.boards,
          screens: outcome.screens,
          created: outcome.created,
          ...(outcome.tier !== undefined ? { tier: outcome.tier } : {}),
          ...(outcome.history !== undefined ? { history: outcome.history } : {}),
        };
      } catch (err) {
        if (err instanceof CloudUnreachableError) {
          throw new Error(`cannot reach ${cloudUrl} (${err.message}) — is velloo-cloud up?`);
        }
        throw err;
      }
    },
  };
}
