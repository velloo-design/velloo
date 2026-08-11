import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "run",
    description: "Start canvas + MCP server for a design folder (Sprint 3+)",
  },
  args: {
    folder: { type: "positional", required: true, description: "Design folder" },
  },
  async run() {
    console.error("velloo run: coming soon (Sprint 3).");
    process.exit(1);
  },
});
