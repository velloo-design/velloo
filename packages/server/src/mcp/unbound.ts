/**
 * What `velloo mcp` serves before it knows which project it is working for.
 *
 * An agent plugin starts its MCP servers in the plugin's own folder (the Agent
 * Plugins spec requires it, and Codex and Cursor send no MCP roots or project
 * path), so a plugin-launched `velloo mcp` usually finds no design where it
 * starts. Exiting would leave the agent with a dead server it can't diagnose;
 * instead the proxy answers on its own with one tool, `open_design`, which the
 * agent calls with its working directory. The agent always knows that path.
 */

export const OPEN_DESIGN_TOOL = "open_design";

export const UNBOUND_INSTRUCTIONS =
  "Velloo (a design canvas for this project's UI) is installed, but this session is not " +
  "attached to a project yet: its MCP server started outside the project, as an agent " +
  `plugin's server does. Before any design work, call \`${OPEN_DESIGN_TOOL}\` with the ` +
  "absolute path of the project you are working in (your current working directory). It " +
  "loads the design tools and their instructions. If the user hasn't asked about design " +
  "or UI, leave this server alone.";

export const OPEN_DESIGN_DEFINITION = {
  name: OPEN_DESIGN_TOOL,
  description:
    "Attach this session to the Velloo design of a project and load the design tools. Pass " +
    "the absolute path of the project you are working in (your current working directory), " +
    "or of a design folder. When the folder has no design yet, the result says how to create one.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path of the project folder (or a design folder inside it).",
      },
    },
    required: ["path"],
  },
} as const;

/** What the caller's `open` hook answers: a daemon to bind to, or why not. */
export type OpenDesignResult = { url: string; name: string } | { error: string };
