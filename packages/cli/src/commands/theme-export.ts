import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "theme:export",
    description: "Export theme as tailwind.config.ts + globals.css in diff mode (Sprint 6)",
  },
  args: {
    to: { type: "string", required: true, description: "Target app directory" },
  },
  async run() {
    console.error("velloo theme:export: coming soon (Sprint 6).");
    process.exit(1);
  },
});
