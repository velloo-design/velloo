import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "upgrade",
    description: "Bump shadcn snapshot, prompt with diff (Sprint 7)",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder" },
  },
  async run() {
    console.error("velloo upgrade: coming soon (Sprint 7).");
    process.exit(1);
  },
});
