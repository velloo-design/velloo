import { defineCommand } from "citty";
import { fail } from "../fail.ts";

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Bump shadcn snapshot, prompt with diff (Sprint 7)",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder" },
  },
  async run() {
    fail("upgrade", "coming soon (Sprint 7).");
  },
});
