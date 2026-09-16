import { defineCommand } from "citty";
import pc from "picocolors";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { verifyCredential } from "../cloud-login.ts";
import { listDaemons } from "../daemon/runtime.ts";
import { designLabel } from "../manifest.ts";

export default defineCommand({
  meta: {
    name: "status",
    description: "List the velloo canvas daemons running on this machine + cloud sign-in",
  },
  args: {},
  async run() {
    const daemons = await listDaemons();
    if (daemons.length === 0) {
      console.log("velloo: no canvas daemons running.");
    } else {
      for (const d of daemons) {
        // Roots read as designs when the checkout knows them: design name +
        // repo-root-relative folder; absolute path as fallback.
        const label = (await designLabel(d.root)) ?? d.root;
        console.log(`${d.canvasUrl}  ${label}  (pid ${d.pid}, since ${d.startedAt})`);
      }
    }

    // Cloud sign-in, verified live with a short timeout so status stays snappy.
    const cloudUrl = defaultCloudUrl();
    const cred = await loadCredential(cloudUrl);
    if (!cred) {
      console.log(pc.dim(`cloud: not signed in (${cloudUrl}) — run \`velloo login\` to share.`));
      return;
    }
    const email = await verifyCredential(cloudUrl, cred.token, 3000);
    console.log(
      email
        ? `cloud: signed in as ${email} (${cloudUrl})`
        : pc.dim(
            `cloud: stored credential for ${cred.email} (${cloudUrl}) — expired or cloud unreachable; \`velloo login\` to refresh.`,
          ),
    );
  },
});
