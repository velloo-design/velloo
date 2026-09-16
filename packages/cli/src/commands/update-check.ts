import { defineCommand } from "citty";
import { refreshUpdateCache } from "../update.ts";

export default defineCommand({
  meta: { name: "__update_check", description: "Internal release check", hidden: true },
  async run() {
    await refreshUpdateCache();
  },
});
