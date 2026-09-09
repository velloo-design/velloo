import type { CanvasUpdateResult, CanvasUpdateStatus, CanvasUpdates } from "@velloo/server";
import { updateStatus, upgradeInstalledVelloo } from "../update.ts";

/**
 * The canvas's view of self-update, backed by the same code `velloo upgrade`
 * runs. Deliberately only the *binary* half: migrating the design folder means
 * rewriting the files this daemon is serving, and the daemon has to be down
 * for that — so the canvas upgrades velloo and then tells the user to restart,
 * which is where the folder migration happens.
 */
export function createCanvasUpdates(): CanvasUpdates {
  return {
    async status(opts = {}): Promise<CanvasUpdateStatus> {
      const status = await updateStatus(opts);
      return {
        current: status.current,
        latest: status.latest,
        available: status.available,
        method: status.method,
        channel: status.channel,
        upgradable: status.upgradable,
        ...(status.reason === undefined ? {} : { reason: status.reason }),
      };
    },
    async upgrade(): Promise<CanvasUpdateResult> {
      const outcome = await upgradeInstalledVelloo();
      return {
        upgraded: outcome.upgraded,
        from: outcome.from,
        to: outcome.to,
        restartRequired: outcome.upgraded,
      };
    },
  };
}
