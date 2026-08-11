import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "emit",
    description: "Codegen: emit a page as idiomatic shadcn JSX (Sprint 6)",
  },
  args: {
    page: { type: "positional", required: true, description: "Path to page JSON" },
    to: { type: "string", required: true, description: "Output .tsx file path" },
  },
  async run() {
    console.error("velloo emit: coming soon (Sprint 6).");
    process.exit(1);
  },
});
