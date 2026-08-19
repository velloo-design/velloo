import { defineCommand } from "citty";
import { listDaemons } from "../daemon/runtime.ts";

export default defineCommand({
  meta: {
    name: "status",
    description: "List the velloo canvas daemons running on this machine",
  },
  args: {},
  async run() {
    const daemons = await listDaemons();
    if (daemons.length === 0) {
      console.log("velloo: no canvas daemons running.");
      return;
    }
    for (const d of daemons) {
      console.log(`${d.canvasUrl}  ${d.root}  (pid ${d.pid}, since ${d.startedAt})`);
    }
  },
});
